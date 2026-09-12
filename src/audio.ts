/** G2 gives signed PCM16 LE, mono 16 kHz. Preserve view offsets and copy bridge-owned buffers. */
export class AudioBatcher {
  private pending = new Uint8Array(3200)
  private size = 0
  constructor(private send: (pcm: Uint8Array) => void) {}
  push(pcm: Uint8Array) {
    if (pcm.byteLength % 2) throw new Error('G2音声のバイト数が不正です。')
    let offset = 0
    while (offset < pcm.length) {
      const count = Math.min(this.pending.length - this.size, pcm.length - offset)
      this.pending.set(pcm.subarray(offset, offset + count), this.size)
      this.size += count
      offset += count
      if (this.size === this.pending.length) this.flush()
    }
  }
  flush() {
    if (!this.size) return
    const data = this.pending.slice(0, this.size)
    this.size = 0
    this.send(data)
  }
  clear() { this.size = 0 }
}

export function pcmLevel(pcm: Uint8Array) {
  if (pcm.byteLength < 2) return 0
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let sum = 0
  const samples = Math.floor(pcm.byteLength / 2)
  for (let i = 0; i < samples; i++) { const v = view.getInt16(i * 2, true) / 32768; sum += v * v }
  return Math.min(1, Math.sqrt(sum / samples) * 5)
}
