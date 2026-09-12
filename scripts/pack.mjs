import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const app = JSON.parse(readFileSync('app.json', 'utf8'))
const backend = process.env.VITE_BACKEND_URL?.trim()
if (backend) {
  const url = new URL(backend)
  if (url.protocol !== 'https:') throw new Error('Cloud packages require an HTTPS VITE_BACKEND_URL.')
  const secureWs = new URL(url.origin); secureWs.protocol = 'wss:'
  app.permissions = app.permissions.map(permission => permission.name === 'network' ? { ...permission, whitelist: [url.origin, secureWs.origin] } : permission)
} else console.log('Packaging for local testing. Set VITE_BACKEND_URL before building a cloud/Beta app.')
mkdirSync('.local', { recursive: true })
writeFileSync('.local/pack-app.json', JSON.stringify(app, null, 2))
const result = spawnSync(process.execPath, ['node_modules/@evenrealities/evenhub-cli/main.js', 'pack', '.local/pack-app.json', 'dist', '-o', `even-translator-${app.version}.ehpk`, '--sdk-ver', app.min_sdk_version], { stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
