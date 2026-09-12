import { spawnSync } from 'node:child_process'

// Run with node --env-file=.env scripts/configure-heroku.mjs.
// Never put secrets in command arguments, generated files, or console output.
const config = { HOST: '0.0.0.0', NODE_ENV: 'production', VITE_BACKEND_URL: 'https://even-translator-b7d8bf8c2521.herokuapp.com' }
for (const key of ['APP_TOKEN', 'DEEPGRAM_API_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL']) {
  config[key] = process.env[key]?.trim() || (key === 'OPENAI_MODEL' ? 'gpt-4.1-mini' : '')
  if (!config[key]) throw new Error(`Missing ${key}`)
}
if (config.APP_TOKEN.length < 24) throw new Error('APP_TOKEN is too short')
const auth = process.platform === 'win32'
  ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'heroku auth:token'], { encoding: 'utf8', windowsHide: true })
  : spawnSync('heroku', ['auth:token'], { encoding: 'utf8' })
if (auth.status !== 0 || !auth.stdout.trim()) throw new Error('Heroku CLI login is required')
const response = await fetch('https://api.heroku.com/apps/even-translator/config-vars', {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${auth.stdout.trim()}`, Accept: 'application/vnd.heroku+json; version=3', 'Content-Type': 'application/json' },
  body: JSON.stringify(config),
})
if (!response.ok) throw new Error(`Heroku config update failed: HTTP ${response.status}`)
console.log('Updated even-translator config vars. Secret values are not displayed.')
