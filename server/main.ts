import { createApp } from './app.js'
import { readConfig, missingKeys } from './config.js'

const config = readConfig()
const app = createApp(config)
app.server.listen(config.port, config.host, () => {
  console.log(`Even Translator backend: http://${config.host}:${config.port}`)
  console.log(`Translation model: ${config.model}`)
  const missing = missingKeys(config)
  console.log(missing.length ? `API configuration missing: ${missing.join(', ')}` : 'Both API keys are configured (values are not logged).')
})
app.server.on('error', error => { console.error(error.message); process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit()) })
