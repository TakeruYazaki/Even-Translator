import { networkInterfaces } from 'node:os'
import { mkdirSync, writeFileSync } from 'node:fs'
import qr from 'qr-image'

const addresses = Object.values(networkInterfaces()).flat()
  .filter(address => address && address.family === 'IPv4' && !address.internal)
  .map(address => address.address)

let appUrl = process.argv[2]
if (!appUrl && addresses.length !== 1) {
  console.error('Specify the PC LAN URL, for example: npm.cmd run qr -- http://192.168.11.10:5173')
  console.error('Available IPv4 addresses:', addresses.join(', '))
  process.exit(1)
}
appUrl ??= `http://${addresses[0]}:5173`
const parsed = new URL(appUrl)
if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Use an HTTP or HTTPS URL.')
mkdirSync('.local', { recursive: true })
writeFileSync('.local/qr.png', qr.imageSync(parsed.href, { type: 'png', size: 10, margin: 4 }))
writeFileSync('.local/url.txt', parsed.href + '\n')
console.log(`Even App QR URL: ${parsed.href}`)
console.log('Open .local/qr.png on the PC, then scan it from Even Realities App on the phone.')
