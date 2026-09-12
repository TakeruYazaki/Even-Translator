import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
const sdkMock = readFileSync('tests/fixtures/sdk-mock.js', 'utf8')

test.beforeEach(async ({ page }) => {
  await page.route('**/*even_hub_sdk*', route => route.fulfill({ contentType: 'application/javascript', body: sdkMock }))
})

test('G2 microphone diagnostic runs without a server and stops on tap', async ({ page }) => {
  const failures: string[] = []; page.on('pageerror', error => failures.push(error.message))
  await page.goto('/')
  await expect(page.locator('#start')).toBeEnabled()
  await page.selectOption('#mode', 'diagnostic'); await page.click('#start')
  await expect(page.locator('#state')).toHaveText('マイク確認中')
  await expect(page.locator('#audio-seconds')).not.toHaveText('0.0 秒')
  await page.evaluate(() => (window as any).__g2test.emit({ sysEvent: {} }))
  await expect(page.locator('#state')).toHaveText('待機')
  expect(await page.evaluate(() => (window as any).__g2test.micOn)).toBe(false)
  await expect(page.locator('#error')).toBeHidden()
  expect(failures).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '.local/ui-mobile.png', fullPage: true })
})

test('streamed audio yields Japanese subtitle and original history; stop keeps final translation', async ({ page }) => {
  let audioPackets = 0
  await page.routeWebSocket('**/ws', ws => {
    ws.onMessage(message => {
      if (typeof message !== 'string') {
        if (++audioPackets === 1) {
          ws.send(JSON.stringify({ type: 'segment', id: 1, en: 'We did not find a significant difference.', receivedAt: Date.now() }))
          ws.send(JSON.stringify({ type: 'translation', id: 1, en: 'We did not find a significant difference.', ja: '有意差は認められませんでした。', latencyMs: 100 }))
        }
        return
      }
      const data = JSON.parse(message)
      if (data.type === 'start') ws.send(JSON.stringify({ type: 'ready', sessionId: 'test-session', model: 'test' }))
      if (data.type === 'stop') {
        ws.send(JSON.stringify({ type: 'segment', id: 2, en: 'There were 24 participants.', receivedAt: Date.now() }))
        ws.send(JSON.stringify({ type: 'translation', id: 2, en: 'There were 24 participants.', ja: '参加者は24人でした。', latencyMs: 100 }))
        ws.send(JSON.stringify({ type: 'stopped' }))
      }
    })
  })
  await page.goto('/'); await page.fill('#token', 'test-connection-code-at-least-24'); await page.click('#start')
  await expect(page.locator('#caption')).toContainText('有意差は認められませんでした。')
  await expect(page.locator('#history')).toContainText('We did not find a significant difference.')
  await page.click('#stop'); await expect(page.locator('#state')).toHaveText('待機')
  await expect(page.locator('#history')).toContainText('参加者は24人でした。')
  expect(audioPackets).toBeGreaterThan(0)
  expect(await page.evaluate(() => (window as any).__g2test.micOn)).toBe(false)
  await expect(page.locator('#caption')).toContainText('24人', { timeout: 1000 })
  await page.screenshot({ path: '.local/ui-translation.png', fullPage: true })
})

test('live captions replace old pages promptly while manual history browsing remains stable', async ({ page }) => {
  let emit: (id: number, ja: string) => void = () => { throw new Error('Socket not ready') }
  await page.routeWebSocket('**/ws', ws => {
    emit = (id, ja) => {
      ws.send(JSON.stringify({ type: 'segment', id, en: `Question ${id}.`, receivedAt: Date.now() }))
      ws.send(JSON.stringify({ type: 'translation', id, en: `Question ${id}.`, ja, latencyMs: 10 }))
    }
    ws.onMessage(message => {
      if (typeof message === 'string' && JSON.parse(message).type === 'start') ws.send(JSON.stringify({ type: 'ready', sessionId: 'live', model: 'test' }))
    })
  })
  await page.goto('/'); await page.fill('#token', 'test-connection-code-at-least-24'); await page.click('#start')
  await expect(page.locator('#state')).toHaveText('翻訳中')
  emit(1, '最初の長い質問です。'.repeat(30))
  await expect(page.locator('#caption')).toContainText('最初の')
  emit(2, '新しい質問です。')
  await expect(page.locator('#caption')).toHaveText('新しい質問です。', { timeout: 1000 })
  await expect.poll(() => page.evaluate(() => (window as any).__g2test.renders.at(-1)), { timeout: 1500 }).toContain('新しい質問です。')
  await page.click('#previous')
  const previous = await page.locator('#caption').textContent()
  emit(3, '三番目の質問です。')
  await expect(page.locator('#history')).toContainText('三番目の質問です。')
  await expect(page.locator('#caption')).toHaveText(previous!)
  await page.click('#latest'); await expect(page.locator('#caption')).toHaveText('三番目の質問です。')
})

test('connection failure never starts the G2 microphone', async ({ page }) => {
  await page.routeWebSocket('**/ws', ws => ws.onMessage(() => ws.send(JSON.stringify({ type: 'error', message: '接続コードが違います。' }))))
  await page.goto('/'); await page.fill('#token', 'wrong'); await page.click('#start')
  await expect(page.locator('#error')).toContainText('接続コードが違います')
  expect(await page.evaluate(() => (window as any).__g2test.opens)).toBe(0)
  await expect(page.locator('#start')).toBeEnabled()
})

test('cancel while microphone is opening leaves it off, and double tap exits', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__micDelay = 700 })
  await page.goto('/'); await page.selectOption('#mode', 'diagnostic'); await page.click('#start')
  await expect(page.locator('#state')).toHaveText('接続中'); await page.click('#stop')
  await expect(page.locator('#state')).toHaveText('待機')
  expect(await page.evaluate(() => (window as any).__g2test.micOn)).toBe(false)
  await page.evaluate(() => (window as any).__g2test.emit({ sysEvent: { eventType: 3 } }))
  await expect(page.locator('#state')).toHaveText('終了')
  expect(await page.evaluate(() => (window as any).__g2test.exited)).toBe(true)
})
