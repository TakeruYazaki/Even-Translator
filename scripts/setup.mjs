import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

if (!existsSync('.env')) {
  const template = readFileSync('.env.example', 'utf8')
  const code = randomBytes(24).toString('base64url')
  writeFileSync('.env', template.replace('APP_TOKEN=', `APP_TOKEN=${code}`), { mode: 0o600 })
  mkdirSync('.local', { recursive: true })
  writeFileSync('.local/connection-code.txt', code + '\n', { mode: 0o600 })
  console.log('Created .env and .local/connection-code.txt. Enter both API keys in .env; keep the connection code unchanged.')
} else {
  console.log('.env already exists; left unchanged.')
}
