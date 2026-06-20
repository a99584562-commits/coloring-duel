import { useEffect, useRef, useState } from 'react'
import { Lobby, Waiting } from './components/Lobby'
import { UploadScreen, WaitImage } from './components/UploadScreen'
import { ColoringBoard } from './components/ColoringBoard'
import { CompareScreen } from './components/CompareScreen'
import { Net, makeRoomCode, normalizeCode, describeError } from './lib/net'
import {
  loadImage,
  downscaleToImageData,
  buildColoringPage,
  imageDataToDataURL,
  dataURLToImageData,
  renderBoard,
} from './lib/colorize'

const DEMO_PALETTE = [
  0x1b1b1f, 0xffe2c4, 0x5aa9f7, 0x2a52be, 0xf472b6,
  0xe11d48, 0xfcd34d, 0x16a34a, 0xa78bfa, 0xc7ccd4,
]

// Demo-only synthetic fills (used when there is no real partner to compare to).
function randomFill(page, density, seed = 0) {
  const a = new Int32Array(page.regionCount)
  for (let i = 0; i < a.length; i++) {
    const r = ((i * 73 + seed * 31 + 17) % 100) / 100
    a[i] = r < density ? DEMO_PALETTE[(i * 7 + seed) % DEMO_PALETTE.length] : -1
  }
  return a
}

export default function App() {
  const netRef = useRef(null)
  const screenRef = useRef('lobby')
  const connectTimerRef = useRef(null)

  const [screen, setScreen] = useState('lobby')
  const [role, setRole] = useState(null)
  const [roomCode, setRoomCode] = useState('')
  const [initialCode, setInitialCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const [page, setPage] = useState(null)
  const [roundId, setRoundId] = useState(0)
  const [mineFinal, setMineFinal] = useState(null)
  const [partner, setPartner] = useState(null)
  const [isDemo, setIsDemo] = useState(false)
  const [demoSrc, setDemoSrc] = useState(null)

  useEffect(() => { screenRef.current = screen }, [screen])

  // both players finished → show comparison
  useEffect(() => {
    if (mineFinal && partner) setScreen('compare')
  }, [mineFinal, partner])

  // entry: handle ?demo and ?join
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const demo = params.get('demo')
    const join = params.get('join')
    if (demo) { runDemo(demo); return }
    if (join) {
      const code = normalizeCode(join)
      if (code.length === 4) { setInitialCode(code); startGuest(code); return }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runDemo(kind) {
    setIsDemo(true)
    const src = import.meta.env.BASE_URL + 'demo.jpg'
    setDemoSrc(src)
    if (kind === 'upload') { setScreen('upload'); return }
    const image = await loadImage(src)
    const imageData = downscaleToImageData(image)
    const p = buildColoringPage(imageData, { threshold: 185, minArea: 12, closeRadius: 2 })
    setPage(p)
    setRoundId((r) => r + 1)
    if (kind === 'compare') {
      setMineFinal(imageDataToDataURL(renderBoard(p, randomFill(p, 0.7, 0), null)))
      setPartner(imageDataToDataURL(renderBoard(p, randomFill(p, 0.95, 4), null)))
      setScreen('compare')
    } else {
      setScreen('coloring')
    }
  }

  // ---- networking -----------------------------------------------------------

  function attachHandlers(net, asRole) {
    net.on('open', () => {
      clearTimeout(connectTimerRef.current)
      setBusy(false)
      setError('')
      setScreen(asRole === 'host' ? 'upload' : 'wait-image')
    })
    net.on('message', async (msg) => {
      if (msg.type === 'image') {
        const imageData = await dataURLToImageData(msg.png)
        const p = buildColoringPage(imageData, { threshold: msg.threshold, minArea: msg.minArea, closeRadius: msg.closeRadius })
        setMineFinal(null)
        setPartner(null)
        setPage(p)
        setRoundId((r) => r + 1)
        setScreen('coloring')
      } else if (msg.type === 'done') {
        setPartner(msg.img)
      } else if (msg.type === 'restart') {
        setMineFinal(null)
        setPartner(null)
        setPage(null)
        setScreen('wait-image')
      }
    })
    net.on('close', () => {
      if (['coloring', 'wait-partner', 'compare'].includes(screenRef.current)) {
        setError('Напарник отключился.')
      } else {
        setError('Соединение разорвано.')
        goLobby()
      }
    })
    net.on('error', (e) => {
      setBusy(false)
      setError(describeError(e))
      if (['lobby', 'host-wait', 'connecting'].includes(screenRef.current)) goLobby()
    })
  }

  function startHost() {
    setError('')
    setBusy(true)
    const code = makeRoomCode()
    setRoomCode(code)
    setRole('host')
    const net = new Net()
    netRef.current = net
    attachHandlers(net, 'host')
    net.host(code)
    setScreen('host-wait')
    armConnectTimeout()
  }

  function startGuest(code) {
    const c = normalizeCode(code)
    if (c.length !== 4) return
    setError('')
    setBusy(true)
    setRoomCode(c)
    setRole('guest')
    const net = new Net()
    netRef.current = net
    attachHandlers(net, 'guest')
    net.join(c)
    setScreen('connecting')
    armConnectTimeout()
  }

  function armConnectTimeout() {
    clearTimeout(connectTimerRef.current)
    connectTimerRef.current = setTimeout(() => {
      setError('Долго не подключается. Проверьте, что у обоих один код и есть интернет — или пересоздайте комнату. Связь идёт через публичные релеи, иногда нужно 10–20 секунд.')
    }, 20000)
  }

  function goLobby() {
    clearTimeout(connectTimerRef.current)
    try { netRef.current?.destroy() } catch { /* ignore */ }
    netRef.current = null
    setRole(null)
    setRoomCode('')
    setPage(null)
    setMineFinal(null)
    setPartner(null)
    setBusy(false)
    setScreen('lobby')
  }

  function hardExit() {
    try { netRef.current?.destroy() } catch { /* ignore */ }
    window.location.href = import.meta.env.BASE_URL
  }

  // ---- round flow -----------------------------------------------------------

  function hostStart({ imageData, page: builtPage, threshold, minArea, closeRadius }) {
    if (!isDemo) {
      const png = imageDataToDataURL(imageData)
      netRef.current?.send({ type: 'image', png, threshold, minArea, closeRadius })
    }
    setMineFinal(null)
    setPartner(null)
    setPage(builtPage)
    setRoundId((r) => r + 1)
    setScreen('coloring')
  }

  function handleDone(src) {
    setMineFinal(src)
    if (isDemo) {
      setPartner((prev) => prev ?? imageDataToDataURL(renderBoard(page, randomFill(page, 0.92, 4), null)))
      return
    }
    netRef.current?.send({ type: 'done', img: src })
    if (!partner) setScreen('wait-partner')
  }

  function handleRestart() {
    setMineFinal(null)
    setPartner(null)
    if (isDemo) { setScreen('upload'); return }
    netRef.current?.send({ type: 'restart' })
    setScreen('upload')
  }

  async function shareLink() {
    const url = `${window.location.origin}${window.location.pathname}?join=${roomCode}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Раскраска-дуэль', text: `Заходи в комнату ${roomCode}`, url })
      } else {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      }
    } catch { /* user cancelled */ }
  }

  // ---- render ---------------------------------------------------------------

  if (screen === 'lobby') {
    return <Lobby onCreate={startHost} onJoin={startGuest} error={error} busy={busy} initialCode={initialCode} />
  }
  if (screen === 'host-wait') {
    return (
      <Waiting
        title="Ждём напарника"
        code={roomCode}
        subtitle="Передайте код или ссылку второму игроку. Как только он войдёт — выберете картинку."
        onShare={shareLink}
      >
        {copied && <p className="text-xs font-medium text-violet">Ссылка скопирована ✓</p>}
        {error && <p className="max-w-xs rounded-2xl bg-pink/10 px-4 py-2.5 text-center text-xs font-medium text-[#b3245f] ring-1 ring-pink/20">{error}</p>}
        <button onClick={goLobby} className="text-sm font-medium text-mute transition-colors hover:text-ink">
          Отмена
        </button>
      </Waiting>
    )
  }
  if (screen === 'connecting') {
    return (
      <Waiting title={`Подключаюсь к ${roomCode}…`} subtitle="Устанавливаем прямое соединение между устройствами.">
        {error && <p className="max-w-xs rounded-2xl bg-pink/10 px-4 py-2.5 text-center text-xs font-medium text-[#b3245f] ring-1 ring-pink/20">{error}</p>}
        <button onClick={goLobby} className="text-sm font-medium text-mute transition-colors hover:text-ink">
          Отмена
        </button>
      </Waiting>
    )
  }
  if (screen === 'wait-image') {
    return <WaitImage />
  }
  if (screen === 'upload') {
    return <UploadScreen onStart={hostStart} defaultSrc={isDemo ? demoSrc : null} />
  }
  if (screen === 'coloring' && page) {
    return (
      <ColoringBoard
        key={roundId}
        page={page}
        roomCode={roomCode}
        partnerDone={!!partner}
        onDone={handleDone}
      />
    )
  }
  if (screen === 'wait-partner') {
    return (
      <Waiting title="Вы закончили!" subtitle="Ждём, пока напарник нажмёт «Готово» — и сразу сравним работы.">
        {partner && <p className="text-xs font-medium text-violet">Напарник тоже готов — открываю сравнение…</p>}
      </Waiting>
    )
  }
  if (screen === 'compare' && page) {
    return (
      <CompareScreen
        page={page}
        mineSrc={mineFinal}
        partnerSrc={partner}
        role={role}
        isDemo={isDemo}
        onRestart={handleRestart}
        onExit={hardExit}
      />
    )
  }

  return <Lobby onCreate={startHost} onJoin={startGuest} error={error} busy={busy} initialCode={initialCode} />
}
