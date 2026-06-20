// net.js — tiny P2P transport over PeerJS (public broker, no server of ours).
//
// One side hosts under a short room code, the other joins by typing it. The
// only non-trivial bit is chunking: the coloring-page PNG can be a few hundred
// KB, which is unreliable to push through a single WebRTC datachannel message
// (Safari in particular). So we split big JSON payloads into ~48KB string
// chunks and reassemble them on the far side, transparently.

import Peer from 'peerjs'

const PREFIX = 'colorduel-v1-'
// No ambiguous characters (0/O, 1/I) so a code is easy to read out loud.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CHUNK = 48 * 1024

export function makeRoomCode() {
  let s = ''
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return s
}

export function normalizeCode(input) {
  return (input || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 4)
}

export class Net {
  constructor() {
    this.peer = null
    this.conn = null
    this.handlers = {}
    this._rx = new Map()
    this.destroyed = false
  }

  on(event, fn) {
    this.handlers[event] = fn
    return this
  }

  _emit(event, ...args) {
    this.handlers[event]?.(...args)
  }

  host(code) {
    this.peer = new Peer(PREFIX + code, { debug: 1 })
    this.peer.on('open', () => this._emit('status', 'waiting'))
    this.peer.on('connection', (conn) => this._setupConn(conn))
    this.peer.on('error', (e) => this._emit('error', e))
  }

  join(code) {
    this.peer = new Peer({ debug: 1 })
    this.peer.on('open', () => {
      const conn = this.peer.connect(PREFIX + code, { reliable: true })
      this._setupConn(conn)
    })
    this.peer.on('error', (e) => this._emit('error', e))
  }

  _setupConn(conn) {
    this.conn = conn
    conn.on('open', () => this._emit('open'))
    conn.on('data', (raw) => this._onRaw(raw))
    conn.on('close', () => this._emit('close'))
    conn.on('error', (e) => this._emit('error', e))
  }

  send(obj) {
    if (!this.conn || !this.conn.open) return false
    const s = JSON.stringify(obj)
    if (s.length <= CHUNK) {
      this.conn.send({ k: 'm', s })
      return true
    }
    const id = Math.random().toString(36).slice(2)
    const total = Math.ceil(s.length / CHUNK)
    for (let i = 0; i < total; i++) {
      this.conn.send({ k: 'c', id, i, total, s: s.slice(i * CHUNK, (i + 1) * CHUNK) })
    }
    return true
  }

  _onRaw(raw) {
    if (!raw || typeof raw !== 'object') return
    if (raw.k === 'm') {
      this._deliver(raw.s)
      return
    }
    if (raw.k === 'c') {
      let buf = this._rx.get(raw.id)
      if (!buf) { buf = { parts: new Array(raw.total), got: 0 }; this._rx.set(raw.id, buf) }
      if (buf.parts[raw.i] === undefined) { buf.parts[raw.i] = raw.s; buf.got++ }
      if (buf.got === raw.total) {
        this._rx.delete(raw.id)
        this._deliver(buf.parts.join(''))
      }
    }
  }

  _deliver(jsonString) {
    let obj
    try { obj = JSON.parse(jsonString) } catch { return }
    this._emit('message', obj)
  }

  get connected() {
    return !!(this.conn && this.conn.open)
  }

  destroy() {
    this.destroyed = true
    try { this.conn?.close() } catch { /* ignore */ }
    try { this.peer?.destroy() } catch { /* ignore */ }
  }
}

// Friendly Russian text for the PeerJS error types we actually hit.
export function describeError(err) {
  const t = err?.type
  if (t === 'unavailable-id') return 'Код комнаты уже занят — создай новую комнату.'
  if (t === 'peer-unavailable') return 'Комната не найдена. Проверь код — возможно, хост ещё не создал её.'
  if (t === 'network' || t === 'server-error') return 'Проблема с сетью/брокером. Проверь интернет и попробуй ещё раз.'
  if (t === 'browser-incompatible') return 'Браузер не поддерживает WebRTC.'
  if (t === 'disconnected') return 'Соединение с брокером потеряно.'
  return 'Не удалось установить соединение: ' + (t || 'неизвестная ошибка') + '.'
}
