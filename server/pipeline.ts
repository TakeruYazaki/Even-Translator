import type { Profile, ServerMessage } from '../shared/protocol.js'
import { ProviderError, type Providers, type SttResult } from './providers.js'

export class TranslationPipeline {
  private pending = ''
  private lastEnd = -1
  private flushTimer?: ReturnType<typeof setTimeout>
  private queue: { id: number; en: string; receivedAt: number }[] = []
  private nextId = 1
  private working = false
  private closed = false
  private history: { en: string; ja: string }[] = []
  private aborter = new AbortController()
  private drainWaiters: (() => void)[] = []

  constructor(private profile: Profile, private translate: Providers['translate'], private send: (message: ServerMessage) => void, private fatal: (message: string) => void, private flushMs = 500) {}

  get depth() { return this.queue.length + Number(this.working) }

  accept(result: SttResult) {
    if (this.closed) return
    if (result.type === 'UtteranceEnd') { this.flush(); return }
    if (result.type !== 'Results') return
    const alternative = result.channel?.alternatives?.[0]
    if (!alternative) return
    if (!result.is_final) { this.send({ type: 'interim', text: alternative.transcript }); return }
    const end = (result.start ?? 0) + (result.duration ?? 0)
    if (alternative.transcript.trim() && end > this.lastEnd + 0.00001) {
      // Deduplicate replayed final spans by timestamp, never by text: repetitions can be meaningful.
      const text = result.start !== undefined && result.start < this.lastEnd && alternative.words?.length
        ? alternative.words.filter(word => word.end > this.lastEnd + 0.00001).map(word => word.punctuated_word || word.word).join(' ')
        : alternative.transcript
      this.lastEnd = end
      this.pending = [this.pending, text.trim()].filter(Boolean).join(' ')
      this.send({ type: 'interim', text: '' })
      if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), this.flushMs)
      if (/[.!?]["')]*$/.test(text.trim()) || this.pending.length >= 240) this.flush()
    }
    if (result.speech_final) this.flush()
  }

  flush() {
    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    if (!this.pending || this.closed) return
    // Bound each API request, preserving every character even for anomalously long STT segments.
    const pieces = this.pending.match(/.{1,1200}(?:\s|$)|.{1,1200}/gs) ?? [this.pending]
    this.pending = ''
    for (const piece of pieces) {
      const segment = { id: this.nextId++, en: piece.trim(), receivedAt: Date.now() }
      if (!segment.en) continue
      this.send({ type: 'segment', ...segment })
      if (this.depth >= 8) {
        this.send({ type: 'translation_error', id: segment.id, message: '翻訳待ちが多すぎるため停止しました。原文は履歴に残しています。' })
        this.fatal('翻訳が追いついていません。通信状態を確認して再開してください。')
        return
      }
      this.queue.push(segment)
    }
    void this.run()
  }

  private async run() {
    if (this.working || this.closed) return
    this.working = true
    try {
      while (this.queue.length && !this.closed) {
        const segment = this.queue.shift()!
        const translationStartedAt = Date.now()
        try {
          const ja = await this.translate(segment.en, this.profile, this.history, this.aborter.signal)
          if (this.closed) break
          this.history.push({ en: segment.en, ja })
          this.history = this.history.slice(-4)
          this.send({ type: 'translation', id: segment.id, en: segment.en, ja, latencyMs: Date.now() - segment.receivedAt, queueMs: translationStartedAt - segment.receivedAt, apiMs: Date.now() - translationStartedAt })
        } catch (error) {
          if (!this.closed) this.send({ type: 'translation_error', id: segment.id, message: error instanceof Error ? error.message : '翻訳に失敗しました。' })
          if (!this.closed && error instanceof ProviderError && error.fatal) { this.fatal(error.message); break }
        }
      }
    } finally {
      this.working = false
      this.drainWaiters.splice(0).forEach(resolve => resolve())
    }
  }

  async drain() {
    this.flush()
    if (!this.working && !this.queue.length) return
    await new Promise<void>(resolve => this.drainWaiters.push(resolve))
  }

  close() {
    this.closed = true
    clearTimeout(this.flushTimer)
    this.aborter.abort()
    this.queue = []
    this.drainWaiters.splice(0).forEach(resolve => resolve())
  }
}
