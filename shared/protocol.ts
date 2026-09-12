import { z } from 'zod'

export const profileSchema = z.object({
  title: z.string().trim().max(200),
  context: z.string().trim().max(8000),
  glossary: z.array(z.object({ en: z.string().trim().min(1).max(100), ja: z.string().trim().max(100) })).max(50),
}).superRefine((profile, ctx) => {
  if (new TextEncoder().encode(profile.glossary.map(term => term.en).join(' ')).length > 500) {
    ctx.addIssue({ code: 'custom', message: '英語用語が多すぎます。重要な用語に絞ってください（合計500バイトまで）。', path: ['glossary'] })
  }
})
export type Profile = z.infer<typeof profileSchema>

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('check'), token: z.string().max(256) }),
  z.object({ type: z.literal('start'), token: z.string().max(256), profile: profileSchema }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('ping') }),
])
export type ServerMessage =
  | { type: 'config'; ready: boolean; missing: string[]; model: string }
  | { type: 'ready'; sessionId: string; model: string }
  | { type: 'interim'; text: string }
  | { type: 'segment'; id: number; en: string; receivedAt: number }
  | { type: 'translation'; id: number; en: string; ja: string; latencyMs: number; queueMs?: number; apiMs?: number }
  | { type: 'translation_error'; id: number; message: string }
  | { type: 'error'; message: string }
  | { type: 'metrics'; audioSeconds: number; packets: number; lastAudioAt: number; maxAudioGapMs: number; queueDepth: number }
  | { type: 'stopped' }

export const defaultProfile: Profile = {
  title: 'English → Japanese',
  context: 'Translate English speech into Japanese. No specific topic or background has been provided.',
  glossary: [],
}

export function parseGlossary(text: string): Profile['glossary'] {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const separator = line.indexOf('=')
    return separator < 0 ? { en: line, ja: '' } : { en: line.slice(0, separator).trim(), ja: line.slice(separator + 1).trim() }
  })
}
