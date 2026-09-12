// This opt-in check makes real, billable API calls using a short synthetic WAV.
import { readFileSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import { readConfig, missingKeys } from '../server/config.js'
import { createApp } from '../server/app.js'
import { defaultProfile, type ServerMessage } from '../shared/protocol.js'

const config = readConfig()
if (missingKeys(config).length) throw new Error('Save both API keys in .env before running the live check.')
const wav = readFileSync(process.argv[2] || '.local/test-question.wav')
if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected a WAV file.')
let pcm: Buffer | undefined, validFormat = false
for (let offset = 12; offset + 8 <= wav.length;) {
  const id = wav.toString('ascii', offset, offset + 4), size = wav.readUInt32LE(offset + 4), start = offset + 8
  if (start + size > wav.length) throw new Error('Truncated WAV')
  if (id === 'fmt ' && size >= 16) validFormat = wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 2) === 1 && wav.readUInt32LE(start + 4) === 16000 && wav.readUInt16LE(start + 14) === 16
  if (id === 'data') pcm = wav.subarray(start, start + size)
  offset = start + size + (size % 2)
}
if (!validFormat || !pcm?.length || pcm.length > 32000 * 30) throw new Error('Use 16 kHz mono PCM16 WAV, at most 30 seconds.')
const app = createApp(config)
app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening')
const ws = new WebSocket(`ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`)
const messages: ServerMessage[] = []
let failed = ''
ws.on('error', () => { failed = 'Local WebSocket failed' })
ws.on('message', data => {
  const message = JSON.parse(data.toString()) as ServerMessage
  messages.push(message)
  if (message.type === 'error' || message.type === 'translation_error') failed = message.message
})
async function waitFor(type: ServerMessage['type'], ms: number) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (failed) throw new Error(failed)
    if (messages.some(message => message.type === type)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${type}`)
}
try {
  await once(ws, 'open')
  ws.send(JSON.stringify({ type: 'start', token: config.token, profile: defaultProfile }))
  await waitFor('ready', 15000)
  for (let offset = 0; offset < pcm.length; offset += 3200) {
    if (failed) throw new Error(failed)
    ws.send(pcm.subarray(offset, offset + 3200))
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  ws.send(JSON.stringify({ type: 'stop' }))
  await waitFor('stopped', 35000)
  const translations = messages.filter(message => message.type === 'translation')
  if (!translations.length) throw new Error('No translations received')
  const report = { date: new Date().toISOString(), source: 'synthetic English speech (not G2)', audioSeconds: pcm.length / 32000, model: config.model, translations }
  writeFileSync('.local/live-smoke.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { ws.terminate(); await app.close() }
