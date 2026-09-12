export interface Config {
  token: string
  deepgramKey: string
  openaiKey: string
  model: string
  host: string
  port: number
}

export function readConfig(env = process.env): Config {
  const token = env.APP_TOKEN?.trim() || ''
  if (token.length < 24) throw new Error('APP_TOKEN must have at least 24 characters. Run npm run setup first.')
  const port = Number(env.PORT || 8787)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
  return {
    token, port, host: env.HOST || (env.DYNO ? '0.0.0.0' : '127.0.0.1'),
    deepgramKey: env.DEEPGRAM_API_KEY?.trim() || '',
    openaiKey: env.OPENAI_API_KEY?.trim() || '',
    model: env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
  }
}

export function missingKeys(config: Config) {
  return [!config.deepgramKey && 'DEEPGRAM_API_KEY', !config.openaiKey && 'OPENAI_API_KEY'].filter(Boolean) as string[]
}
