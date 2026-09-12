import { spawnSync } from 'node:child_process'

// Keep local .env unchanged. Use the same origin for both the bundle and manifest.
const env = { ...process.env, VITE_BACKEND_URL: 'https://even-translator-b7d8bf8c2521.herokuapp.com' }
for (const args of [
  ['node_modules/typescript/bin/tsc', '--noEmit'],
  ['node_modules/vite/bin/vite.js', 'build'],
  ['--env-file-if-exists=.env', 'scripts/pack.mjs'],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
