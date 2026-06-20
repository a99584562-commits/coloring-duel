// net.js — P2P transport for the coloring duel.
//
// Uses Trystero (nostr strategy) for signalling: peers find each other through
// public Nostr relays by a shared room code — no server of ours, and far more
// reliable than the public PeerJS broker. WebRTC is hardened with STUN + free
// TURN so two laptops on *different* networks (behind NAT) can still connect;
// without TURN, cross-network WebRTC often silently fails.
//
// Public API matches what App.jsx expects:
//   net.host(code) / net.join(code) / net.on(ev, fn) / net.send(obj) / net.destroy()
// Events: 'open' (peer connected), 'message' (obj), 'close' (peer left).

import { joinRoom } from 'trystero/nostr'

const APP_ID = 'colorduel-v1'
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// STUN discovers your public address; TURN relays media when a direct path is
// blocked by NAT/firewall. Open Relay (metered.ca) is a free public TURN.
const TURN_SERVERS = [
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
]
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  ...TURN_SERVERS,
]

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
    this.room = null
    this.action = null
    this.peerId = null
    this.handlers = {}
    this.destroyed = false
  }

  on(event, fn) {
    this.handlers[event] = fn
    return this
  }

  _emit(event, ...args) {
    this.handlers[event]?.(...args)
  }

  _open(code) {
    try {
      this.room = joinRoom(
        { appId: APP_ID, rtcConfig: { iceServers: ICE_SERVERS }, turnConfig: TURN_SERVERS },
        code,
      )
    } catch (e) {
      this._emit('error', e)
      return
    }
    const action = this.room.makeAction('m')
    action.onMessage = (data) => this._emit('message', data)
    this.action = action
    this.room.onPeerJoin = (id) => { this.peerId = id; this._emit('open') }
    this.room.onPeerLeave = () => { this.peerId = null; this._emit('close') }
  }

  // host and guest both just join the same room; roles are decided app-side.
  host(code) { this._open(code) }
  join(code) { this._open(code) }

  send(obj) {
    if (!this.action) return false
    try {
      // Trystero auto-chunks large payloads (the coloring-page PNG) for us.
      this.action.send(obj)
      return true
    } catch {
      return false
    }
  }

  get connected() {
    return !!this.peerId
  }

  destroy() {
    this.destroyed = true
    try { this.room?.leave() } catch { /* ignore */ }
    this.room = null
    this.action = null
    this.peerId = null
  }
}

export function describeError() {
  return 'Не удалось установить соединение. Проверьте интернет и попробуйте пересоздать комнату.'
}
