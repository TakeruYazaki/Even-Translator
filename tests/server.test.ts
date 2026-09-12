import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import { createApp } from '../server/app.js'
import { defaultProfile, type ServerMessage } from '../shared/protocol.js'
import type { Providers, SttHandlers } from '../server/providers.js'
import type { Config } from '../server/config.js'

const config: Config = { token: 'test-connection-code-at-least-24', openaiKey: 'test-key', deepgramKey: 'test-key', model: 'test-model', host: '127.0.0.1', port: 0 }
async function fixture(t: TestContext, overrides?: Partial<Providers>) {
  let opens = 0, received = 0, closes = 0
  let handler: SttHandlers | undefined
  const providers: Providers = {
    openStt: async (_profile, callbacks) => {
      opens++; handler = callbacks
      return {
        sendAudio(pcm) {
          received += pcm.length
          callbacks.result({ type: 'Results', is_final: true, start: 0, duration: 0.1, channel: { alternatives: [{ transcript: 'Could you explain your method?' }] } })
        },
        async finish() {
          callbacks.result({ type: 'Results', is_final: true, start: 0.1, duration: 1, channel: { alternatives: [{ transcript: 'We did not find an effect' }] } })
        },
        close() { closes++ },
      }
    },
    translate: async en => '訳：' + en,
    ...overrides,
  }
  const app = createApp(config, providers)
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening')
  t.after(() => app.close())
  const port = (app.server.address() as AddressInfo).port
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  const messages: ServerMessage[] = []
  ws.on('message', data => messages.push(JSON.parse(data.toString())))
  await once(ws, 'open')
  async function waitFor(predicate: (message: ServerMessage) => boolean) {
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) { const match = messages.find(predicate); if (match) return match; await new Promise(resolve => setTimeout(resolve, 5)) }
    assert.fail('Expected server message was not received: ' + JSON.stringify(messages))
  }
  return { ws, port, messages, waitFor, counts: () => ({ opens, received, closes }), handler: () => handler }
}

test('unauthorized clients cannot open a paid STT connection', async t => {
  const f = await fixture(t)
  f.ws.send(JSON.stringify({ type: 'start', token: 'wrong', profile: defaultProfile }))
  await f.waitFor(message => message.type === 'error')
  assert.equal(f.counts().opens, 0)
})
test('authenticated PCM -> final transcripts -> ordered translations; stop flushes trailing speech', async t => {
  const f = await fixture(t)
  f.ws.send(JSON.stringify({ type: 'start', token: config.token, profile: defaultProfile }))
  await f.waitFor(message => message.type === 'ready')
  f.ws.send(Buffer.alloc(3200))
  await f.waitFor(message => message.type === 'translation' && message.id === 1)
  f.ws.send(JSON.stringify({ type: 'ping' }))
  const metrics = await f.waitFor(message => message.type === 'metrics')
  assert.equal(metrics.type === 'metrics' && metrics.audioSeconds, 0.1)
  f.ws.send(JSON.stringify({ type: 'stop' }))
  await f.waitFor(message => message.type === 'stopped')
  const texts = f.messages.filter(message => message.type === 'translation').map(message => message.en)
  assert.deepEqual(texts, ['Could you explain your method?', 'We did not find an effect'])
  assert.equal(f.counts().received, 3200)
  assert.equal(f.counts().closes, 1)
})
test('malformed PCM and untrusted control messages fail visibly', async t => {
  const f = await fixture(t)
  f.ws.send(JSON.stringify({ type: 'start', token: config.token, profile: defaultProfile }))
  await f.waitFor(message => message.type === 'ready')
  f.ws.send(Buffer.alloc(3))
  await f.waitFor(message => message.type === 'error')
  assert.equal(f.counts().received, 0)
})
test('configuration check does not call providers; .env is never served', async t => {
  const f = await fixture(t)
  f.ws.send(JSON.stringify({ type: 'check', token: config.token }))
  const reply = await f.waitFor(message => message.type === 'config')
  assert.equal(reply.type === 'config' && reply.ready, true)
  assert.equal(f.counts().opens, 0)
  assert.equal((await fetch(`http://127.0.0.1:${f.port}/.env`)).status, 404)
  assert.equal((await fetch(`http://127.0.0.1:${f.port}/health`)).status, 200)
})
test('disconnect aborts pending translation and releases the microphone stream', async t => {
  let aborted = false
  const f = await fixture(t, { translate: async (_en, _profile, _history, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }, { once: true })
  }) })
  f.ws.send(JSON.stringify({ type: 'start', token: config.token, profile: defaultProfile }))
  await f.waitFor(message => message.type === 'ready'); f.ws.send(Buffer.alloc(3200))
  await f.waitFor(message => message.type === 'segment')
  f.ws.close(); await once(f.ws, 'close')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(aborted, true); assert.equal(f.counts().closes, 1)
})
