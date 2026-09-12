import './style.css'
import { waitForEvenAppBridge, TextContainerProperty, CreateStartUpPageContainer, TextContainerUpgrade, OsEventTypeList, AudioInputSource, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { defaultProfile, parseGlossary, profileSchema, type ServerMessage } from '../shared/protocol'
import { AudioBatcher, pcmLevel } from './audio'
import { subtitlePages } from './subtitles'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const startButton = $<HTMLButtonElement>('start'), stopButton = $<HTMLButtonElement>('stop')
const mode = $<HTMLSelectElement>('mode'), fields = $<HTMLFieldSetElement>('settings-fields')
const status = $('status'), errorBox = $('error'), caption = $('caption'), interim = $('interim')
const input = (id: string) => $<HTMLInputElement>(id)
const area = (id: string) => $<HTMLTextAreaElement>(id)
type Phase = 'idle' | 'starting' | 'reconnecting' | 'listening' | 'stopping' | 'error' | 'exited'
class TransportError extends Error {}
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let reconnectAttempts = 0, connectedAt = 0
function cancelReconnect() { clearTimeout(reconnectTimer); reconnectTimer = undefined }
let phase: Phase = 'idle', bridge: EvenAppBridge | undefined, bridgeReady = false
let socket: WebSocket | undefined, runId = 0, activeMic = false, micMayBeOpen = false
let micQueue: Promise<unknown> = Promise.resolve()
let bytes = 0, frames = 0, lastFrameAt = 0, maxFrameGapMs = 0, startedAt = 0, stoppedAt = 0, displayUpdates = 0
let serverAudioSeconds = 0, serverGapMs = 0, queueDepth = 0, lastServerAt = 0, latestLatency = 0, microphoneLevel = 0
let pingTimer: ReturnType<typeof setInterval> | undefined, stopTimer: ReturnType<typeof setTimeout> | undefined
let audioFlushTimer: ReturnType<typeof setInterval> | undefined
let unsubscribe = () => {}
let pages: string[] = [], pageIndex = -1, followLive = true
let pageTimer: ReturnType<typeof setTimeout> | undefined
let renderTimer: ReturnType<typeof setTimeout> | undefined, rendering = false, lastRendered = '', desiredGlasses = ''
interface Entry { key: string; en: string; ja?: string; error?: string; at: string; latencyMs?: number; queueMs?: number; apiMs?: number }
const history: Entry[] = []
const diagnostics: { at: string; event: string }[] = []
const settingsKey = 'even-translator-settings-v1'

function log(event: string) { diagnostics.push({ at: new Date().toISOString(), event }); if (diagnostics.length > 300) diagnostics.shift() }
function showError(message: string) { errorBox.hidden = false; errorBox.textContent = message; log(message) }
function setPhase(next: Phase, message: string) {
  phase = next; status.textContent = message
  $('state').textContent = { idle: '待機', starting: '接続中', reconnecting: '再接続中', listening: mode.value === 'diagnostic' ? 'マイク確認中' : '翻訳中', stopping: '完了待ち', error: '停止・要確認', exited: '終了' }[phase]
  const busy = ['starting', 'reconnecting', 'listening', 'stopping'].includes(phase)
  startButton.disabled = !bridgeReady || busy || phase === 'exited'
  stopButton.disabled = !['starting', 'reconnecting', 'listening'].includes(phase)
  mode.disabled = busy; fields.disabled = busy; $<HTMLButtonElement>('clear').disabled = busy
  log(`state:${next}`); updateCaption()
}
function loadSettings() {
  let saved: Record<string, string> = {}
  try { saved = JSON.parse(localStorage.getItem(settingsKey) || '{}') || {} } catch { /* Fresh settings if storage is unavailable. */ }
  input('backend').value = saved.backend || import.meta.env.VITE_BACKEND_URL || ''
  input('token').value = saved.token ?? ''
  input('title').value = saved.title ?? defaultProfile.title
  area('context').value = saved.context ?? defaultProfile.context
  area('glossary').value = saved.glossary ?? defaultProfile.glossary.map(term => `${term.en} = ${term.ja}`).join('\n')
  if (!input('token').value) $<HTMLDetailsElement>('settings').open = true
}
function currentProfile() {
  const parsed = profileSchema.safeParse({ title: input('title').value, context: area('context').value, glossary: parseGlossary(area('glossary').value) })
  if (!parsed.success) throw new Error('発表情報または用語が長すぎます。概要は8000字まで、用語は50件以内で重要なものに絞ってください。')
  return parsed.data
}
function wsUrl() {
  const url = new URL(input('backend').value.trim() || location.origin)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('接続先にはhttp://またはhttps://から始まるURLを入力してください。')
  if (location.protocol === 'https:' && url.protocol !== 'https:') throw new Error('HTTPSで開いたアプリにはHTTPSのバックエンドが必要です。')
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws'; url.search = ''; url.hash = ''; url.username = ''; url.password = ''
  return url.href
}
function saveSettings() {
  currentProfile(); wsUrl()
  localStorage.setItem(settingsKey, JSON.stringify({ backend: input('backend').value.trim(), token: input('token').value.trim(), title: input('title').value, context: area('context').value, glossary: area('glossary').value }))
}
function advanceLater() {
  if (pageTimer || !followLive || pageIndex < 0) return
  const hold = Math.max(4000, Math.min(12000, (pages[pageIndex]?.length || 0) / 16 * 1000))
  pageTimer = setTimeout(() => { pageTimer = undefined; if (followLive && pageIndex < pages.length - 1) { pageIndex++; updateCaption(); advanceLater() } }, hold)
}
function addSubtitle(text: string) {
  const firstNewPage = pages.length
  pages.push(...subtitlePages(text))
  // Live captions prioritize new translations. Manual history browsing stays put.
  if (followLive || pageIndex < 0) {
    clearTimeout(pageTimer); pageTimer = undefined
    pageIndex = firstNewPage
  }
  updateCaption(); advanceLater()
}
function updateCaption() {
  const body = phase === 'reconnecting' ? '通信が切れました。再接続しています。\n切断中の音声は翻訳されません。\nタップで再接続を中止' : pages[pageIndex] || (mode.value === 'diagnostic' && activeMic
    ? `マイク確認中\n受信: ${(bytes / 32000).toFixed(1)} 秒\nフレーム: ${frames}\n最大間隔: ${(maxFrameGapMs / 1000).toFixed(1)} 秒\nタップで停止`
    : '英語の質問を日本語で表示します。\nタップで開始・停止')
  caption.textContent = body
  $('page-count').textContent = `${pageIndex + 1} / ${pages.length}${pages.length > pageIndex + 1 ? `（待ち ${pages.length - pageIndex - 1}）` : ''}`
  $<HTMLButtonElement>('previous').disabled = pageIndex <= 0
  $<HTMLButtonElement>('next').disabled = pageIndex >= pages.length - 1
  desiredGlasses = `${$('state').textContent} ${pageIndex >= 0 ? `${pageIndex + 1}/${pages.length}` : ''}\n${body}`
  scheduleRender()
}
function scheduleRender() {
  if (!bridgeReady || rendering || renderTimer || phase === 'exited' || desiredGlasses === lastRendered) return
  renderTimer = setTimeout(() => { renderTimer = undefined; void renderGlasses() }, 180)
}
async function renderGlasses() {
  if (!bridge || !bridgeReady || phase === 'exited') return
  rendering = true
  const text = desiredGlasses
  let succeeded = false
  try {
    const result = await timeout(bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'main', content: text })), 8000, 'G2表示APIが応答していません。')
    if (!result) throw new Error('G2字幕の更新に失敗しました。接続を確認してください。')
    lastRendered = text; displayUpdates++; succeeded = true
  } catch (error) { showError(error instanceof Error ? error.message : 'G2表示に失敗しました。') }
  finally { rendering = false; if (succeeded) scheduleRender() }
}
function renderHistory() {
  area('history-text').value = history.map(entry => `${entry.at}\nEN: ${entry.en}\nJA: ${entry.ja || entry.error || '翻訳待ち'}`).join('\n\n')
  const root = $('history'); root.replaceChildren()
  if (!history.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'まだ翻訳履歴はありません。'; root.append(empty); return }
  for (const entry of history.slice(-100).reverse()) {
    const article = document.createElement('article')
    const time = document.createElement('time'); time.textContent = new Date(entry.at).toLocaleTimeString('ja-JP') + (entry.apiMs !== undefined && entry.queueMs !== undefined ? ` · 順番待ち ${(entry.queueMs / 1000).toFixed(1)}秒 / 翻訳API ${(entry.apiMs / 1000).toFixed(1)}秒` : entry.latencyMs !== undefined ? ` · 翻訳待ち＋処理 ${(entry.latencyMs / 1000).toFixed(1)}秒` : '')
    const ja = document.createElement('p'); ja.className = entry.error ? 'ja failed' : 'ja'; ja.textContent = entry.ja || entry.error || '翻訳しています…'
    const en = document.createElement('p'); en.className = 'en'; en.lang = 'en'; en.textContent = entry.en
    article.append(time, ja, en); root.append(article)
  }
}
function markUntranslated() { for (const entry of history) if (!entry.ja && !entry.error) entry.error = '翻訳を受信できませんでした。英語原文を確認してください。'; renderHistory() }
function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(message)), ms); promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) }) })
}
const batcher = new AudioBatcher(pcm => {
  if (socket?.readyState !== WebSocket.OPEN) throw new Error('音声の送信先に接続されていません。')
  if (socket.bufferedAmount > 128000) throw new Error('音声送信が遅れています。通信状態を確認して再開してください。')
  socket.send(pcm as Uint8Array<ArrayBuffer>)
})
async function micOff() {
  activeMic = false; if (startedAt && !stoppedAt) stoppedAt = Date.now()
  if (!micMayBeOpen || !bridge) return
  const result = await timeout(micCommand(false), 10000, 'マイク停止の応答がありません。G2アプリを終了してください。')
  if (!result) throw new Error('マイク停止に失敗しました。G2アプリを終了してください。')
  micMayBeOpen = false
}
function micCommand(open: boolean) {
  const command = micQueue.catch(() => {}).then(() => bridge!.audioControl(open, AudioInputSource.Glasses))
  micQueue = command
  return command
}
function closeSocket() { clearInterval(pingTimer); clearInterval(audioFlushTimer); clearTimeout(stopTimer); socket?.close(); socket = undefined; batcher.clear() }
function fail(message: string) {
  cancelReconnect()
  showError(message); ++runId; closeSocket()
  void micOff().catch(error => showError(error.message)); markUntranslated()
  if (phase !== 'exited') setPhase('error', '停止しました。接続状態を確認して再開してください。')
}
async function recoverConnection(message: string) {
  if (phase === 'reconnecting' || !['starting', 'listening'].includes(phase)) return
  if (connectedAt && Date.now() - connectedAt > 30000) reconnectAttempts = 0
  connectedAt = 0
  if (reconnectAttempts >= 6) { fail('再接続できませんでした。回線を確認して「開始」を押してください。'); return }
  const delay = Math.min(15000, 1000 * 2 ** reconnectAttempts++)
  const run = ++runId
  closeSocket(); markUntranslated(); interim.textContent = '—'
  setPhase('reconnecting', `${message} ${delay / 1000}秒後に再接続します（${reconnectAttempts}/6）。切断中の音声は翻訳されません。`)
  try { await micOff() } catch (error) { if (run === runId) fail((error as Error).message); return }
  if (run !== runId) return
  reconnectTimer = setTimeout(() => { reconnectTimer = undefined; if (run === runId) void startCapture(true) }, delay)
}
function onServer(message: ServerMessage, run: number) {
  if (run !== runId || phase === 'exited') return
  lastServerAt = Date.now()
  if (message.type === 'error') { fail(message.message); return }
  if (message.type === 'interim') interim.textContent = message.text || '—'
  if (message.type === 'segment') { history.push({ key: `${run}:${message.id}`, en: message.en, at: new Date().toISOString() }); renderHistory() }
  if (message.type === 'translation' || message.type === 'translation_error') {
    const entry = history.find(entry => entry.key === `${run}:${message.id}`)
    if (entry) {
      if (message.type === 'translation') { entry.ja = message.ja; entry.latencyMs = message.latencyMs; entry.queueMs = message.queueMs; entry.apiMs = message.apiMs; latestLatency = message.latencyMs; addSubtitle(message.ja) }
      else { entry.error = message.message; showError(message.message); addSubtitle('翻訳に失敗しました。\nスマホで英語原文を確認してください。') }
      renderHistory()
    }
  }
  if (message.type === 'metrics') { serverAudioSeconds = message.audioSeconds; serverGapMs = message.maxAudioGapMs; queueDepth = message.queueDepth }
  if (message.type === 'stopped') { closeSocket(); markUntranslated(); setPhase('idle', '停止しました。履歴と字幕は残っています。') }
}
async function connect(run: number) {
  const profile = currentProfile(), token = input('token').value.trim()
  if (!token) throw new Error('接続コードを「接続・発表情報・専門用語」に入力してください。')
  const ws = new WebSocket(wsUrl()); socket = ws
  await timeout(new Promise<void>((resolve, reject) => {
    let ready = false
    ws.onopen = () => { if (run === runId) ws.send(JSON.stringify({ type: 'start', token, profile })) }
    ws.onmessage = event => {
      if (run !== runId) return
      let message: ServerMessage
      try { message = JSON.parse(event.data) } catch { reject(new Error('サーバー応答が不正です。')); return }
      if (message.type === 'ready') { ready = true; resolve() }
      else if (message.type === 'error' && !ready) reject(new Error(message.message))
      else onServer(message, run)
    }
    ws.onerror = () => { if (!ready) reject(new TransportError('バックエンドに接続できません。')) }
    ws.onclose = () => {
      if (!ready) reject(new TransportError('開始前に接続が切れました。'))
      if (run !== runId) return
      if (ready && ['starting', 'listening'].includes(phase)) void recoverConnection('通信が切れました。')
      else if (phase === 'stopping') fail('停止中に通信が切れました。未受信の訳は履歴を確認してください。')
    }
  }), 15000, '音声認識サービスへの接続がタイムアウトしました。').catch(error => {
    if (error instanceof Error && error.message === '音声認識サービスへの接続がタイムアウトしました。') throw new TransportError(error.message)
    throw error
  })
}
async function startCapture(reconnecting = false) {
  if (!bridge || !bridgeReady || !(reconnecting ? phase === 'reconnecting' : ['idle', 'error'].includes(phase))) return
  cancelReconnect()
  if (!reconnecting) reconnectAttempts = 0
  errorBox.hidden = true; errorBox.textContent = ''
  const run = ++runId
  bytes = 0; frames = 0; lastFrameAt = 0; maxFrameGapMs = 0; startedAt = Date.now(); stoppedAt = 0; serverAudioSeconds = 0; serverGapMs = 0; queueDepth = 0; lastServerAt = 0
  if (mode.value === 'diagnostic') { pages = []; pageIndex = -1; clearTimeout(pageTimer); pageTimer = undefined }
  setPhase('starting', mode.value === 'diagnostic' ? 'G2マイクを準備しています…' : '音声認識サービスに接続しています…')
  try {
    if (micMayBeOpen) await micOff()
    if (mode.value === 'translate') { saveSettings(); await connect(run) }
    if (run !== runId) return
    if (mode.value === 'translate' && socket?.readyState !== WebSocket.OPEN) throw new TransportError('接続が切れました。')
    micMayBeOpen = true
    const opening = micCommand(true)
    const opened = await timeout(opening, 10000, 'G2マイクの開始応答がありません。アプリの権限を確認してください。')
    if (run !== runId) { await micOff(); return }
    if (!opened) throw new Error('G2マイクを開始できませんでした。Even Appの権限とG2接続を確認してください。')
    activeMic = true; startedAt = Date.now(); stoppedAt = 0
    connectedAt = Date.now(); lastServerAt = Date.now()
    setPhase('listening', mode.value === 'diagnostic' ? 'G2の音声受信を確認中です。APIへは送信していません。' : '英語の質問を聞いています。意味のまとまりごとに日本語を表示します。')
    if (mode.value === 'translate') {
      pingTimer = setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' })) }, 3000)
      audioFlushTimer = setInterval(() => { if (activeMic) { try { batcher.flush() } catch (error) { void recoverConnection((error as Error).message) } } }, 150)
    }
  } catch (error) { if (run === runId) { if (error instanceof TransportError) void recoverConnection(error.message); else fail(error instanceof Error ? error.message : '開始に失敗しました。') } }
}
async function stopCapture() {
  if (!['starting', 'reconnecting', 'listening'].includes(phase)) return
  cancelReconnect()
  const starting = phase === 'starting' || phase === 'reconnecting'
  if (starting) ++runId
  setPhase('stopping', 'マイクを停止し、残りの翻訳を受信しています…')
  try {
    await micOff()
    if (!starting && mode.value === 'translate' && socket?.readyState === WebSocket.OPEN) {
      batcher.flush(); socket.send(JSON.stringify({ type: 'stop' }))
      stopTimer = setTimeout(() => fail('停止後の翻訳受信がタイムアウトしました。'), 35000)
    } else { ++runId; closeSocket(); setPhase('idle', '停止しました。受信音声の秒数を動作診断で確認できます。') }
  } catch (error) { fail(error instanceof Error ? error.message : '停止に失敗しました。') }
}
async function exitApp() {
  cancelReconnect()
  ++runId; closeSocket(); markUntranslated()
  try { await micOff() } catch (error) { showError((error as Error).message) }
  if (!bridge) return
  try { const exited = await bridge.shutDownPageContainer(0); if (!exited) throw new Error('終了に失敗しました。G2の操作でアプリを閉じてください。'); cleanup() }
  catch (error) { showError((error as Error).message); setPhase('error', '翻訳は停止しました。アプリの終了を確認してください。') }
}
function cleanup() {
  cancelReconnect()
  ++runId; activeMic = false; closeSocket(); clearTimeout(pageTimer); clearTimeout(renderTimer); clearInterval(diagnosticsTimer); unsubscribe()
  void micOff().catch(error => showError(error.message)); setPhase('exited', '終了しました。再び利用する場合はアプリを開き直してください。')
}
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }) { return envelope ? (envelope.eventType ?? OsEventTypeList.CLICK_EVENT) : null }
async function connectGlasses() {
  bridge = await waitForEvenAppBridge()
  const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [new TextContainerProperty({
    xPosition: 0, yPosition: 0, width: 576, height: 288, borderWidth: 0, borderColor: 5, paddingLength: 8,
    containerID: 1, containerName: 'main', content: 'CSCW 翻訳\n英語 → 日本語\nタップで開始\n設定はスマホで変更できます。', isEventCapture: 1,
  })] }))
  if (result !== 0) throw new Error(`G2画面の作成に失敗しました (${result})`)
  bridgeReady = true; $('bridge-status').textContent = 'Even App接続済み · G2画面作成API成功'; $<HTMLButtonElement>('exit').disabled = false
  unsubscribe = bridge.onEvenHubEvent(event => {
    const types = [eventTypeOf(event.sysEvent), eventTypeOf(event.textEvent)]
    if (types.includes(OsEventTypeList.SYSTEM_EXIT_EVENT) || types.includes(OsEventTypeList.ABNORMAL_EXIT_EVENT)) { cleanup(); return }
    if (types.includes(OsEventTypeList.DOUBLE_CLICK_EVENT)) { void exitApp(); return }
    const pcm = event.audioEvent?.audioPcm
    if (pcm && activeMic && event.audioEvent?.source === AudioInputSource.Glasses) {
      const now = Date.now(); if (lastFrameAt) maxFrameGapMs = Math.max(maxFrameGapMs, now - lastFrameAt)
      lastFrameAt = now; frames++; bytes += pcm.byteLength; microphoneLevel = pcmLevel(pcm)
      if (mode.value === 'translate') { try { batcher.push(pcm) } catch (error) { void recoverConnection((error as Error).message) } }
      return
    }
    if (types.includes(OsEventTypeList.CLICK_EVENT)) { if (['starting', 'reconnecting', 'listening'].includes(phase)) void stopCapture(); else if (phase === 'idle' || phase === 'error') void startCapture() }
    else if (types.includes(OsEventTypeList.SCROLL_TOP_EVENT)) movePage(-1)
    else if (types.includes(OsEventTypeList.SCROLL_BOTTOM_EVENT)) movePage(1)
  })
  setPhase('idle', '準備ができました。設定を確認して「開始」を押してください。')
}
function movePage(delta: number) {
  if (!pages.length) return
  pageIndex = Math.max(0, Math.min(pages.length - 1, pageIndex + delta)); followLive = pageIndex === pages.length - 1
  clearTimeout(pageTimer); pageTimer = undefined; updateCaption(); if (followLive) advanceLater()
}
function diagnosticSnapshot() {
  return { mode: mode.value, state: phase, elapsedSeconds: startedAt ? ((stoppedAt || Date.now()) - startedAt) / 1000 : 0, audioSeconds: bytes / 32000, frames, maxFrameGapMs, serverAudioSeconds, serverGapMs, displayUpdates, queueDepth, latestTranslationLatencyMs: latestLatency, lastFrameAt, lastServerAt }
}
const diagnosticsTimer = setInterval(() => {
  if (phase === 'listening' && mode.value === 'translate' && Date.now() - lastServerAt > 12000) void recoverConnection('サーバーの応答が途切れました。')
  $<HTMLMeterElement>('level').value = Date.now() - lastFrameAt < 1500 ? microphoneLevel : 0
  $('audio-seconds').textContent = `${(bytes / 32000).toFixed(1)} 秒`
  const snapshot = diagnosticSnapshot()
  const pairs = [['経過時間', `${Math.floor(snapshot.elapsedSeconds)} 秒`], ['G2音声受信', `${snapshot.audioSeconds.toFixed(1)} 秒 / ${frames}フレーム`], ['G2音声の最大受信間隔', `${(maxFrameGapMs / 1000).toFixed(2)} 秒`], ['バックエンドの音声受信', `${serverAudioSeconds.toFixed(1)} 秒`], ['バックエンドの最大受信間隔', `${(serverGapMs / 1000).toFixed(2)} 秒`], ['G2表示API成功', `${displayUpdates} 回`], ['翻訳待ち', `${queueDepth} 件`], ['最終音声から', lastFrameAt ? `${((Date.now() - lastFrameAt) / 1000).toFixed(1)} 秒` : '未受信']]
  $('metrics').replaceChildren(...pairs.flatMap(([label, value]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; return [dt, dd] }))
  if (activeMic && Date.now() - (lastFrameAt || startedAt) > 5000 && !errorBox.textContent?.startsWith('G2音声が')) showError('G2音声が5秒以上届いていません。権限・接続・バックグラウンド停止を確認してください。')
  if (activeMic && mode.value === 'diagnostic') updateCaption()
}, 1000)
$('save').addEventListener('click', () => { try { saveSettings(); $('settings-status').textContent = 'この端末に設定を保存しました。' } catch (error) { $('settings-status').textContent = (error as Error).message } })
$('check').addEventListener('click', async () => {
  $('settings-status').textContent = '接続を確認しています…'
  let checkSocket: WebSocket | undefined
  try {
    saveSettings()
    const result = await timeout(new Promise<Extract<ServerMessage, { type: 'config' }>>((resolve, reject) => {
      checkSocket = new WebSocket(wsUrl())
      checkSocket.onopen = () => checkSocket!.send(JSON.stringify({ type: 'check', token: input('token').value.trim() }))
      checkSocket.onmessage = event => { try { const message = JSON.parse(event.data) as ServerMessage; if (message.type === 'config') resolve(message); else if (message.type === 'error') reject(new Error(message.message)) } catch { reject(new Error('応答が不正です。')) } }
      checkSocket.onerror = () => reject(new Error('サーバーに接続できません。URLと起動状態を確認してください。'))
    }), 10000, '接続確認がタイムアウトしました。')
    $('settings-status').textContent = result.ready ? `接続成功。APIキー設定済み / ${result.model}（API自体の疎通は翻訳開始時に確認）` : `接続成功。未設定: ${result.missing.join(', ')}`
  } catch (error) { $('settings-status').textContent = (error as Error).message }
  finally { checkSocket?.close() }
})
$('reset-glossary').addEventListener('click', () => { area('glossary').value = defaultProfile.glossary.map(term => `${term.en} = ${term.ja}`).join('\n') })
$('context-file').addEventListener('change', async event => {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return
  if (file.size > 100000) { $('settings-status').textContent = '概要ファイルは100KB以下にしてください。'; return }
  try { const text = await file.text(); if (text.length > 8000) throw new Error('概要は8000字以内に要約して入力してください。'); area('context').value = text; $('settings-status').textContent = '概要を読み込みました。「設定を保存」で反映します。' } catch (error) { $('settings-status').textContent = (error as Error).message }
})
startButton.addEventListener('click', () => { void startCapture() }); stopButton.addEventListener('click', () => { void stopCapture() }); $('exit').addEventListener('click', () => { void exitApp() })
$('previous').addEventListener('click', () => movePage(-1)); $('next').addEventListener('click', () => movePage(1))
$('latest').addEventListener('click', () => { if (pages.length) { pageIndex = pages.length - 1; followLive = true; clearTimeout(pageTimer); pageTimer = undefined; updateCaption(); advanceLater() } })
$('clear').addEventListener('click', () => { history.length = 0; pages = []; pageIndex = -1; followLive = true; clearTimeout(pageTimer); pageTimer = undefined; renderHistory(); updateCaption() })
mode.addEventListener('change', updateCaption)
$('export').addEventListener('click', () => {
  const contents = JSON.stringify({ version: '0.2.3', exportedAt: new Date().toISOString(), title: input('title').value, history, diagnostics, metrics: diagnosticSnapshot() }, null, 2)
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = `cscw-translation-${Date.now()}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000)
})
window.addEventListener('pagehide', cleanup)
if (import.meta.hot) import.meta.hot.dispose(cleanup)
loadSettings(); updateCaption()
void connectGlasses().catch(error => { $('bridge-status').textContent = error.message; showError(error.message) })
