import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0', port: 5173, strictPort: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**', '**/server/**', '**/build-server/**', '**/tests/**', '**/scripts/**'] },
    proxy: {
      '/ws': { target: 'http://127.0.0.1:8787', ws: true },
      '/health': { target: 'http://127.0.0.1:8787' },
    },
  },
  build: { target: 'es2022' },
})
