import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

for (const path of ['/', '/health', '/.env', '/.local/connection-code.txt', '/server/config.ts']) {
  const response = await fetch('http://127.0.0.1:5173' + path)
  const privatePath = path.startsWith('/.') || path.startsWith('/server/')
  assert.ok(privatePath ? [403, 404].includes(response.status) : response.status === 200, `Unexpected HTTP status for ${path}`)
  console.log(`${path}: HTTP ${response.status}`)
}
const bundle = readdirSync('dist/assets').filter(name => name.endsWith('.js')).map(name => readFileSync('dist/assets/' + name, 'utf8')).join('')
for (const name of ['APP_TOKEN', 'OPENAI_API_KEY', 'DEEPGRAM_API_KEY']) {
  const value = process.env[name]?.trim()
  if (value) assert.equal(bundle.includes(value), false, `${name} must not appear in the client bundle`)
}
console.log('Client bundle contains no configured API keys or connection code.')
