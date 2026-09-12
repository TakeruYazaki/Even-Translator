import { spawn } from 'node:child_process'
import { watchFile, unwatchFile } from 'node:fs'

let stopping = false
let restarting = false
const children = new Set()
function launch(args) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true })
  children.add(child)
  child.on('error', error => { console.error(error.message); stop(1) })
  child.on('exit', code => {
    children.delete(child)
    if (!stopping && !(restarting && child === backend)) stop(code || 0)
  })
  return child
}
const backendArgs = ['--env-file-if-exists=.env', '--import', 'tsx', 'server/main.ts']
let backend = launch(backendArgs)
launch(['node_modules/vite/bin/vite.js'])
function stop(code = 0) {
  if (stopping) return
  stopping = true
  unwatchFile('.env')
  for (const child of children) child.kill()
  process.exitCode = code
}
watchFile('.env', { interval: 1000 }, () => {
  if (stopping || restarting) return
  restarting = true
  console.log('.env changed; restarting the backend (active sessions will stop).')
  backend.once('exit', () => { if (!stopping) { backend = launch(backendArgs); restarting = false } })
  backend.kill()
})
process.once('SIGINT', () => stop())
process.once('SIGTERM', () => stop())
