'use strict'
// Capture live deltas from a SignalK server as multiplexed I-lines on stdout.
// Usage: node src/capture.js [ws://host:3000] [seconds]
// Reads are anonymous on our server; no token needed.
const WebSocket = require('ws')

const base = process.argv[2] || 'ws://naturalaspi.local:3000'
const seconds = Number(process.argv[3] || 60)
const ws = new WebSocket(`${base}/signalk/v1/stream?subscribe=all`)

ws.on('open', () => setTimeout(() => ws.close(), seconds * 1000))
ws.on('message', buf => {
  const msg = buf.toString()
  let o
  try { o = JSON.parse(msg) } catch { return }
  if (!o.updates) return // hello / subscription acks
  process.stdout.write(`${Date.now()};I;${msg.replace(/\n/g, '')}\n`)
})
ws.on('close', () => process.exit(0))
ws.on('error', e => { console.error(e.message); process.exit(1) })
