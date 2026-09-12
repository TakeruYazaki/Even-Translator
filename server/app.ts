import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import WebSocket, { WebSocketServer } from 'ws'
import { clientMessageSchema, type ServerMessage } from '../shared/protocol.js'
import { missingKeys, type Config } from './config.js'
import { realProviders, type Providers, type SttStream } from './providers.js'
import { TranslationPipeline } from './pipeline.js'

export function tokenMatches(actual: string, expected: string) {
  const a = Buffer.from(actual), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createApp(config: Config, providers: Providers = realProviders(config), dist = resolve('dist')) {
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return }
    if (request.method !== 'GET') { response.writeHead(405).end(); return }
    void (async () => {
      const url = new URL(request.url || '/', 'http://localhost')
      if (url.pathname === '/health') {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ ok: true, app: 'even-translator', version: '0.2.3' }))
        return
      }
      let pathname: string
      try { pathname = decodeURIComponent(url.pathname) } catch { response.writeHead(400).end(); return }
      const target = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname))
      if (!target.startsWith(dist + sep) || pathname.split('/').some(part => part.startsWith('.'))) {
        response.writeHead(404).end(); return
      }
      const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' }
      try {
        const file = await readFile(target)
        response.setHeader('Content-Type', types[extname(target)] || 'application/octet-stream')
        response.setHeader('Cache-Control', extname(target) === '.html' ? 'no-store' : 'public, max-age=3600')
        response.end(file)
      } catch { response.writeHead(404).end() }
    })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end() })
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false })
  let activeSessions = 0
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws' || wss.clients.size >= 8) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws))
  })

  wss.on('connection', ws => {
    let phase: 'new' | 'opening' | 'streaming' | 'stopping' | 'closed' = 'new'
    let stt: SttStream | undefined
    let pipeline: TranslationPipeline | undefined
    let ownsSession = false
    let audioBytes = 0, packets = 0, lastAudioAt = 0, maxAudioGapMs = 0
    let lastMessageAt = Date.now(), startedAt = Date.now()
    let stopTimer: ReturnType<typeof setTimeout> | undefined
    const send = (message: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
    }
    const sendMetrics = () => send({ type: 'metrics', audioSeconds: audioBytes / 32000, packets, lastAudioAt, maxAudioGapMs, queueDepth: pipeline?.depth ?? 0 })
    const cleanup = () => {
      if (phase === 'closed') return
      phase = 'closed'
      clearTimeout(authTimer)
      clearTimeout(stopTimer)
      clearInterval(watchdog)
      stt?.close()
      pipeline?.close()
      if (ownsSession) { activeSessions -= 1; ownsSession = false }
    }
    const fatal = (message: string) => {
      send({ type: 'error', message })
      cleanup()
      ws.close(1011, 'session stopped')
    }
    const authTimer = setTimeout(() => { fatal('接続コードを受信できませんでした。') }, 5000)
    const watchdog = setInterval(() => {
      if (phase === 'closed' || phase === 'stopping') return
      const now = Date.now()
      if (now - lastMessageAt > 20000) fatal('スマホとの通信が20秒以上途切れたため停止しました。')
      else if (phase === 'streaming' && now - (lastAudioAt || startedAt) > 15000) fatal('マイク音声が15秒以上届いていないため停止しました。')
      else if (now - startedAt > 70 * 60 * 1000) fatal('連続利用が70分に達しました。一度停止して再開してください。')
    }, 3000)

    ws.on('error', cleanup)
    ws.on('close', cleanup)
    ws.on('message', (data, binary) => {
      lastMessageAt = Date.now()
      if (binary) {
        if (phase !== 'streaming' || !stt) { fatal('音声認識の準備前に音声を受信しました。'); return }
        const pcm = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
        if (!pcm.length || pcm.length % 2 !== 0 || pcm.length > 64000) { fatal('音声形式が不正です。16-bit PCMが必要です。'); return }
        if ((audioBytes + pcm.length) / 32000 > (Date.now() - startedAt) / 1000 + 5) { fatal('音声データの送信速度が速すぎます。'); return }
        try {
          stt.sendAudio(pcm)
          if (lastAudioAt) maxAudioGapMs = Math.max(maxAudioGapMs, Date.now() - lastAudioAt)
          lastAudioAt = Date.now()
          audioBytes += pcm.length
          packets += 1
        } catch (error) { fatal(error instanceof Error ? error.message : '音声送信に失敗しました。') }
        return
      }
      let parsed: ReturnType<typeof clientMessageSchema.safeParse>
      try { parsed = clientMessageSchema.safeParse(JSON.parse(data.toString())) } catch { fatal('通信メッセージの形式が不正です。'); return }
      if (!parsed.success) { fatal('設定の形式または長さが不正です。発表概要・用語数を確認してください。'); return }
      const message = parsed.data
      if (message.type === 'start' || message.type === 'check') {
        if (phase !== 'new') { fatal('すでに開始済みです。'); return }
        if (!tokenMatches(message.token, config.token)) { fatal('接続コードが違います。PCのconnection-code.txtを確認してください。'); return }
        clearTimeout(authTimer)
        if (message.type === 'check') {
          const missing = missingKeys(config)
          send({ type: 'config', ready: !missing.length, missing, model: config.model })
          cleanup()
          ws.close(1000)
          return
        }
        const missing = missingKeys(config)
        if (missing.length) { fatal(`サーバーの.envに ${missing.join(' / ')} を設定し、サーバーを再起動してください。`); return }
        if (activeSessions >= 2) { fatal('同時接続の上限です。他の翻訳セッションを停止してください。'); return }
        phase = 'opening'
        activeSessions += 1
        ownsSession = true
        pipeline = new TranslationPipeline(message.profile, providers.translate, send, fatal)
        void providers.openStt(message.profile, { result: result => pipeline?.accept(result), error: fatal }).then(stream => {
          if (phase !== 'opening') { stream.close(); return }
          stt = stream
          startedAt = Date.now()
          phase = 'streaming'
          send({ type: 'ready', sessionId: randomUUID(), model: config.model })
        }).catch(error => fatal(error instanceof Error ? error.message : '音声認識の開始に失敗しました。'))
      } else if (message.type === 'ping') {
        if (phase === 'new') return
        sendMetrics()
      } else if (message.type === 'stop') {
        if (phase === 'new' || phase === 'opening') { cleanup(); ws.close(1000); return }
        if (phase !== 'streaming') return
        phase = 'stopping'
        stopTimer = setTimeout(() => fatal('最後の翻訳の完了待ちがタイムアウトしました。原文は履歴を確認してください。'), 30000)
        void (async () => {
          await stt?.finish()
          await pipeline?.drain()
          if (!ownsSession || ws.readyState !== WebSocket.OPEN) return
          sendMetrics()
          send({ type: 'stopped' })
          cleanup()
          ws.close(1000)
        })().catch(error => fatal(error instanceof Error ? error.message : '終了処理に失敗しました。'))
      }
    })
  })

  return {
    server,
    close: () => new Promise<void>(done => {
      for (const ws of wss.clients) ws.terminate()
      wss.close()
      server.close(() => done())
    }),
  }
}
