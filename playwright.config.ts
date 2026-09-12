import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  workers: 1,
  timeout: 20000,
  use: { baseURL: 'http://127.0.0.1:5174', viewport: { width: 390, height: 844 }, channel: 'msedge', headless: true },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: false },
})
