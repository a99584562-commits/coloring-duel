import { useEffect, useRef, useState } from 'react'
import { Panel, Button, Eyebrow, Check, Undo, Eye } from './ui'
import {
  renderBoard, paintPixels, renderOriginal,
  packedToHex, hexToPacked, packRGB, BRUSH_ERASE,
} from '../lib/colorize'

const PALETTE = [
  '#1b1b1f', '#6b7280', '#c7ccd4', '#ffffff',
  '#ffe2c4', '#f4b489', '#c8825a', '#7c4a2d',
  '#bfe3ff', '#5aa9f7', '#2a52be', '#16306e',
  '#ffd1e0', '#f472b6', '#e11d48', '#7f1d34',
  '#fff3a8', '#fcd34d', '#f59e0b', '#16a34a',
  '#a7f3d0', '#3fbf9f', '#a78bfa', '#7c3aed',
].map(hexToPacked)

const SHAPES = ['circle', 'square', 'triangle', 'diamond']

function inShape(shape, dx, dy, r) {
  switch (shape) {
    case 'square': return Math.abs(dx) <= r && Math.abs(dy) <= r
    case 'diamond': return Math.abs(dx) + Math.abs(dy) <= r
    case 'triangle': {
      if (dy < -r || dy > r) return false
      const halfW = (r * (dy + r)) / (2 * r) // apex at top, widest at bottom
      return Math.abs(dx) <= halfW
    }
    default: return dx * dx + dy * dy <= r * r
  }
}

export function ColoringBoard({ page, roomCode, partnerDone, onDone }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const workingRef = useRef(null)
  const originalRef = useRef(null)

  const colorsRef = useRef(null) // region fills (Int32Array, -1 = empty)
  const brushRef = useRef(null)  // free-hand layer (Int32Array, -1 none / -2 erase / packed)
  const historyRef = useRef([])
  const strokeRef = useRef(null) // Map<pixel, prevBrushValue> during a brush stroke
  const paintingRef = useRef(false)
  const panningRef = useRef(false)
  const panStartRef = useRef(null)
  const lastRegionRef = useRef(-1)
  const lastXYRef = useRef(null)
  const peekRef = useRef(false)
  const spaceRef = useRef(false)
  const returnToolRef = useRef('fill') // tool to restore after a one-shot eyedropper pick

  const [tool, setTool] = useState('fill')
  const [shape, setShape] = useState('circle')
  const [brushSize, setBrushSize] = useState(12)
  const [selected, setSelected] = useState(PALETTE[10])
  const [lastHex, setLastHex] = useState(packedToHex(PALETTE[10]))
  const [filled, setFilled] = useState(0)
  const [peeking, setPeeking] = useState(false)
  const [done, setDone] = useState(false)

  // zoom / pan
  const [fit, setFit] = useState({ w: 0, h: 0 })
  const [z, setZ] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [grabbing, setGrabbing] = useState(false)
  const [hover, setHover] = useState(false)
  const cursorRef = useRef(null)

  if (colorsRef.current === null) { colorsRef.current = new Int32Array(page.regionCount).fill(-1) }
  if (brushRef.current === null) { brushRef.current = new Int32Array(page.width * page.height).fill(-1) }

  // initial draw
  useEffect(() => {
    const canvas = canvasRef.current
    canvas.width = page.width
    canvas.height = page.height
    const ctx = canvas.getContext('2d')
    ctxRef.current = ctx
    workingRef.current = renderBoard(page, colorsRef.current, brushRef.current)
    originalRef.current = renderOriginal(page)
    ctx.putImageData(workingRef.current, 0, 0)
  }, [page])

  // fit-to-container + recompute on resize
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const compute = () => {
      const cw = el.clientWidth, ch = el.clientHeight
      const s = Math.min(cw / page.width, ch / page.height)
      const fw = page.width * s, fh = page.height * s
      setFit({ w: fw, h: fh })
      setZ(1); setTx((cw - fw) / 2); setTy((ch - fh) / 2)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [page])

  // wheel zoom anchored at cursor (non-passive so we can preventDefault)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      // gentle zoom: scale by scroll amount but cap each event to ±8% so it
      // ramps smoothly instead of snapping to max on a laptop trackpad/wheel
      let dy = e.deltaY
      if (e.deltaMode === 1) dy *= 16 // lines → ~pixels
      else if (e.deltaMode === 2) dy *= 400 // pages → ~pixels
      let factor = Math.exp(-dy * 0.0012)
      factor = Math.max(0.92, Math.min(1.08, factor))
      zoomAround(mx, my, factor)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [z, tx, ty])

  function zoomAround(mx, my, factor) {
    const nz = clamp(z * factor, 1, 9)
    if (nz === z) return
    setTx(mx - (mx - tx) * (nz / z))
    setTy(my - (my - ty) * (nz / z))
    setZ(nz)
  }
  function zoomButton(factor) {
    const el = containerRef.current
    zoomAround(el.clientWidth / 2, el.clientHeight / 2, factor)
  }
  function resetView() {
    const el = containerRef.current
    const cw = el.clientWidth, ch = el.clientHeight
    setZ(1); setTx((cw - fit.w) / 2); setTy((ch - fit.h) / 2)
  }

  // ---- painting ----
  function canvasXY(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) * (page.width / rect.width))
    const y = Math.floor((e.clientY - rect.top) * (page.height / rect.height))
    return { x, y }
  }

  function countFilled() {
    const c = colorsRef.current
    let n = 0
    for (let i = 0; i < c.length; i++) if (c[i] >= 0) n++
    setFilled(n)
  }

  function applyFill(region, colorVal) {
    if (region < 0) return
    const colors = colorsRef.current
    if (colors[region] === colorVal) return
    historyRef.current.push({ t: 'fill', region, prev: colors[region] })
    trimHistory()
    colors[region] = colorVal
    paintPixels(workingRef.current, page, colors, brushRef.current, page.regionPixels[region])
    if (!peekRef.current) ctxRef.current.putImageData(workingRef.current, 0, 0)
    countFilled()
  }

  function stampStroke(x0, y0, x1, y1, value) {
    const r = brushSize
    const w = page.width, h = page.height
    const brush = brushRef.current
    const stroke = strokeRef.current
    const dx = x1 - x0, dy = y1 - y0
    const dist = Math.hypot(dx, dy)
    const steps = Math.max(1, Math.round(dist / Math.max(1, r / 2)))
    const px = []
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps
      const cx = Math.round(x0 + dx * t), cy = Math.round(y0 + dy * t)
      for (let oy = -r; oy <= r; oy++) {
        const y = cy + oy
        if (y < 0 || y >= h) continue
        for (let ox = -r; ox <= r; ox++) {
          const x = cx + ox
          if (x < 0 || x >= w) continue
          if (!inShape(shape, ox, oy, r)) continue
          const p = y * w + x
          if (brush[p] === value) continue
          if (stroke && !stroke.has(p)) stroke.set(p, brush[p])
          brush[p] = value
          px.push(p)
          if (x < minX) minX = x; if (x > maxX) maxX = x
          if (y < minY) minY = y; if (y > maxY) maxY = y
        }
      }
    }
    if (px.length === 0) return
    paintPixels(workingRef.current, page, colorsRef.current, brush, px)
    if (!peekRef.current) {
      ctxRef.current.putImageData(workingRef.current, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1)
    }
  }

  function strokeValue() {
    return tool === 'eraser' ? BRUSH_ERASE : selected
  }

  function onPointerDown(e) {
    if (done) return
    // pan with Space held or middle mouse
    if (spaceRef.current || e.button === 1) {
      panningRef.current = true
      setGrabbing(true)
      panStartRef.current = { x: e.clientX, y: e.clientY, tx, ty }
      try { containerRef.current.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      return
    }
    if (peekRef.current || e.button !== 0) return
    const { x, y } = canvasXY(e)
    if (tool === 'pick') { sampleColorAt(x, y); return }
    try { containerRef.current.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    paintingRef.current = true
    if (tool === 'fill') {
      const region = page.regionMap[y * page.width + x]
      lastRegionRef.current = region
      applyFill(region, e.altKey ? -1 : selected)
    } else {
      strokeRef.current = new Map()
      lastXYRef.current = { x, y }
      stampStroke(x, y, x, y, strokeValue())
    }
  }

  function positionCursor(e) {
    const el = cursorRef.current
    if (!el) return
    const rect = containerRef.current.getBoundingClientRect()
    el.style.transform = `translate(${e.clientX - rect.left}px, ${e.clientY - rect.top}px) translate(-50%, -50%)`
  }

  function onPointerMove(e) {
    positionCursor(e)
    if (panningRef.current) {
      const s = panStartRef.current
      setTx(s.tx + (e.clientX - s.x))
      setTy(s.ty + (e.clientY - s.y))
      return
    }
    if (!paintingRef.current || done || peekRef.current) return
    const { x, y } = canvasXY(e)
    if (tool === 'fill') {
      const region = page.regionMap[y * page.width + x]
      if (region === lastRegionRef.current) return
      lastRegionRef.current = region
      applyFill(region, e.altKey ? -1 : selected)
    } else {
      const last = lastXYRef.current
      stampStroke(last.x, last.y, x, y, strokeValue())
      lastXYRef.current = { x, y }
    }
  }

  function endPaint() {
    if (paintingRef.current && strokeRef.current && strokeRef.current.size > 0) {
      historyRef.current.push({ t: 'brush', changes: strokeRef.current })
      trimHistory()
    }
    strokeRef.current = null
    paintingRef.current = false
    panningRef.current = false
    lastRegionRef.current = -1
    setGrabbing(false)
  }

  function trimHistory() {
    if (historyRef.current.length > 200) historyRef.current.shift()
  }

  function undo() {
    const op = historyRef.current.pop()
    if (!op) return
    if (op.t === 'fill') {
      colorsRef.current[op.region] = op.prev
      paintPixels(workingRef.current, page, colorsRef.current, brushRef.current, page.regionPixels[op.region])
      if (!peekRef.current) ctxRef.current.putImageData(workingRef.current, 0, 0)
      countFilled()
    } else {
      const brush = brushRef.current
      const px = []
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
      for (const [p, prev] of op.changes) {
        brush[p] = prev
        px.push(p)
        const x = p % page.width, y = (p / page.width) | 0
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
      paintPixels(workingRef.current, page, colorsRef.current, brush, px)
      if (!peekRef.current) ctxRef.current.putImageData(workingRef.current, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1)
    }
  }

  function clearAll() {
    colorsRef.current.fill(-1)
    brushRef.current.fill(-1)
    historyRef.current = []
    workingRef.current = renderBoard(page, colorsRef.current, brushRef.current)
    if (!peekRef.current) ctxRef.current.putImageData(workingRef.current, 0, 0)
    countFilled()
  }

  function setPeek(v) {
    peekRef.current = v
    setPeeking(v)
    ctxRef.current.putImageData(v ? originalRef.current : workingRef.current, 0, 0)
  }

  function pickColor(packed) {
    setSelected(packed)
    setLastHex(packedToHex(packed))
    // eyedropper is one-shot → go back to painting; eraser → switch to brush
    if (tool === 'pick') setTool(returnToolRef.current || 'brush')
    else if (tool === 'eraser') setTool('brush')
  }

  function chooseTool(t) {
    if (t === 'pick' && tool !== 'pick') returnToolRef.current = tool
    setTool(t)
  }

  function sampleColorAt(x, y) {
    const d = workingRef.current.data
    const i = (y * page.width + x) * 4
    pickColor(packRGB(d[i], d[i + 1], d[i + 2]))
  }

  function finish() {
    if (done) return
    setDone(true)
    onDone(canvasRef.current.toDataURL('image/png'))
  }

  // keyboard
  useEffect(() => {
    const down = (e) => {
      if (done) return
      if (e.code === 'Space') { e.preventDefault(); spaceRef.current = true; setGrabbing(true); return }
      if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return }
      if (e.key === 'z' || e.key === 'Z') { undo(); return }
      if (e.key === 'b' || e.key === 'B') { chooseTool('brush'); return }
      if (e.key === 'g' || e.key === 'G') { chooseTool('fill'); return }
      if (e.key === 'e' || e.key === 'E') { chooseTool('eraser'); return }
      if (e.key === 'i' || e.key === 'I') { chooseTool('pick'); return }
      if (e.key === '+' || e.key === '=') { zoomButton(1.2); return }
      if (e.key === '-' || e.key === '_') { zoomButton(1 / 1.2); return }
      if (e.key === 'Enter') { e.preventDefault(); finish(); return }
      if (/^[0-9]$/.test(e.key)) {
        const idx = e.key === '0' ? 9 : Number(e.key) - 1
        if (idx < PALETTE.length) pickColor(PALETTE[idx])
      }
    }
    const up = (e) => {
      if (e.code === 'Space') { spaceRef.current = false; if (!panningRef.current) setGrabbing(false) }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, selected, tool, shape, brushSize, z, tx, ty, fit])

  const pct = Math.round((filled / page.regionCount) * 100)
  const pickerHex = packedToHex(selected)
  const cursor = grabbing ? 'grabbing' : peeking ? 'default' : spaceRef.current ? 'grab' : 'crosshair'
  const brushTool = tool === 'brush' || tool === 'eraser'
  const cursorScale = page.width ? (fit.w / page.width) * z : 1
  const cursorDia = Math.max(8, 2 * brushSize * cursorScale)
  const showCursor = brushTool && hover && !grabbing && !peeking

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-[1400px] px-4 py-6">
      <div className="rise mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Eyebrow>Комната {roomCode || '—'}</Eyebrow>
          {partnerDone && !done && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-500/20">
              <Check size={12} /> напарник готов
            </span>
          )}
        </div>
        <p className="hidden text-xs text-mute lg:block">
          <Kbd>G</Kbd> заливка · <Kbd>B</Kbd> кисть · <Kbd>I</Kbd> пипетка · <Kbd>E</Kbd> ластик · <Kbd>Z</Kbd> отмена · <Kbd>Пробел</Kbd> двигать
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_330px]">
        <Panel className="rise">
          <div
            ref={containerRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPaint}
            onPointerEnter={() => setHover(true)}
            onPointerLeave={() => { setHover(false); endPaint() }}
            className="relative overflow-hidden rounded-[1.4rem] bg-[repeating-conic-gradient(#f1f1f5_0%_25%,#fafafb_0%_50%)] bg-[length:22px_22px]"
            style={{ height: '80vh', touchAction: 'none' }}
          >
            <canvas
              ref={canvasRef}
              className="paint-surface absolute left-0 top-0 origin-top-left"
              style={{ width: fit.w, height: fit.h, transform: `translate(${tx}px, ${ty}px) scale(${z})`, cursor, imageRendering: z > 2.5 ? 'pixelated' : 'auto' }}
            />
            {/* brush cursor preview */}
            <div
              ref={cursorRef}
              className="pointer-events-none absolute left-0 top-0 z-10"
              style={{ width: cursorDia, height: cursorDia, opacity: showCursor ? 1 : 0, transition: 'opacity .12s' }}
            >
              <BrushCursor shape={shape} size={cursorDia} />
            </div>
            {/* zoom controls */}
            <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-white/85 p-1 ring-1 ring-[color:var(--color-line)] backdrop-blur">
              <ZoomBtn onClick={() => zoomButton(1 / 1.2)}>–</ZoomBtn>
              <button onClick={resetView} className="px-2 text-xs font-semibold text-ink-soft hover:text-ink">{Math.round(z * 100)}%</button>
              <ZoomBtn onClick={() => zoomButton(1.2)}>+</ZoomBtn>
            </div>
          </div>
        </Panel>

        <div className="rise flex flex-col gap-4" style={{ animationDelay: '0.08s' }}>
          {/* tools */}
          <Panel>
            <div className="p-4">
              <div className="grid grid-cols-4 gap-2">
                <ToolBtn active={tool === 'fill'} onClick={() => chooseTool('fill')} icon={<FillIco />} label="Заливка" />
                <ToolBtn active={tool === 'brush'} onClick={() => chooseTool('brush')} icon={<BrushIco />} label="Кисть" />
                <ToolBtn active={tool === 'eraser'} onClick={() => chooseTool('eraser')} icon={<EraseIco />} label="Ластик" />
                <ToolBtn active={tool === 'pick'} onClick={() => chooseTool('pick')} icon={<PickIco />} label="Пипетка" />
              </div>

              {brushTool && (
                <div className="mt-4 flex flex-col gap-4 border-t border-[color:var(--color-line)] pt-4">
                  <div className="flex items-center justify-between gap-2">
                    {SHAPES.map((s) => (
                      <button
                        key={s}
                        onClick={() => setShape(s)}
                        className={`flex h-10 flex-1 items-center justify-center rounded-xl transition-all duration-300 ${shape === s ? 'bg-ink text-white' : 'bg-ink/5 text-ink-soft hover:bg-ink/10'}`}
                      >
                        <ShapeIco shape={s} />
                      </button>
                    ))}
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-xs font-semibold text-ink-soft">Размер кисти</span>
                      <span className="font-display text-sm font-semibold text-violet">{brushSize * 2}px</span>
                    </div>
                    <input type="range" min={2} max={70} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="duel-range w-full" />
                  </div>
                </div>
              )}
            </div>
          </Panel>

          {/* colour */}
          <Panel>
            <div className="p-4">
              <div className="mb-3 flex items-center gap-3">
                <div className="h-11 w-11 rounded-2xl ring-1 ring-black/10" style={{ background: pickerHex }} />
                <label className="group flex flex-1 cursor-pointer items-center justify-between rounded-2xl bg-ink/5 px-4 py-3 transition-colors hover:bg-ink/10">
                  <span className="text-sm font-semibold text-ink-soft">Любой цвет</span>
                  <span className="relative flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-black/10" style={{ background: pickerHex }}>
                    <input type="color" value={pickerHex} onChange={(e) => pickColor(hexToPacked(e.target.value))} className="absolute inset-0 cursor-pointer opacity-0" />
                  </span>
                </label>
              </div>
              <div className="grid grid-cols-8 gap-1.5">
                {PALETTE.map((packed, i) => {
                  const isSel = selected === packed && tool !== 'eraser'
                  const hex = packedToHex(packed)
                  return (
                    <button
                      key={i}
                      onClick={() => pickColor(packed)}
                      title={hex}
                      className={`relative aspect-square rounded-lg transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${isSel ? 'scale-110 ring-2 ring-ink ring-offset-2 ring-offset-white' : 'ring-1 ring-black/10 hover:scale-110'}`}
                      style={{ background: hex }}
                    />
                  )
                })}
              </div>
            </div>
          </Panel>

          {/* actions */}
          <Panel>
            <div className="flex items-center gap-2 p-3">
              <SmallBtn onPointerDown={() => setPeek(true)} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)} icon={<Eye size={15} />}>Оригинал</SmallBtn>
              <SmallBtn onClick={undo} icon={<Undo size={15} />}>Отмена</SmallBtn>
              <SmallBtn onClick={clearAll}>Сброс</SmallBtn>
            </div>
          </Panel>

          {/* progress + done */}
          <Panel>
            <div className="flex flex-col gap-4 p-5">
              <div>
                <div className="mb-2 flex items-baseline justify-between text-sm">
                  <span className="font-semibold text-ink">Закрашено зон</span>
                  <span className="font-display text-lg font-semibold text-violet">{pct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ink/5">
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,#7c3aed,#ec4899)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <Button variant="accent" icon={<Check />} onClick={finish} disabled={done} className="w-full">
                {done ? 'Готово — ждём напарника' : 'Я закончил'}
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function ToolBtn({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-xl py-2.5 text-[11px] font-semibold transition-all duration-300 ${active ? 'bg-ink text-white' : 'bg-ink/5 text-ink-soft hover:bg-ink/10'}`}
    >
      {icon}
      {label}
    </button>
  )
}

function SmallBtn({ children, icon, ...rest }) {
  return (
    <button {...rest} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink/5 py-2.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-ink/10 active:bg-ink/15">
      {icon}{children}
    </button>
  )
}

function ZoomBtn({ children, onClick }) {
  return (
    <button onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-full text-lg font-semibold text-ink-soft transition-colors hover:bg-ink/10 hover:text-ink">
      {children}
    </button>
  )
}

function Kbd({ children }) {
  return <kbd className="rounded-md bg-ink/5 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-ink-soft ring-1 ring-[color:var(--color-line)]">{children}</kbd>
}

// icons
const istroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }
const FillIco = () => <svg width="18" height="18" viewBox="0 0 24 24" {...istroke}><path d="M5 12l6-6 7 7-6 6a2 2 0 0 1-3 0l-4-4a2 2 0 0 1 0-3Z" /><path d="M11 6 9 4" /><path d="M19 15s2 2.5 2 4a2 2 0 1 1-4 0c0-1.5 2-4 2-4Z" /></svg>
const BrushIco = () => <svg width="18" height="18" viewBox="0 0 24 24" {...istroke}><path d="M14 4l6 6-9 9H5v-6l9-9Z" /><path d="M13 7l4 4" /></svg>
const EraseIco = () => <svg width="18" height="18" viewBox="0 0 24 24" {...istroke}><path d="M4 15l7-7 6 6-5 5H7l-3-3a1.5 1.5 0 0 1 0-1Z" /><path d="M9 20h11" /></svg>
const PickIco = () => <svg width="18" height="18" viewBox="0 0 24 24" {...istroke}><path d="M19.5 4.5a2.1 2.1 0 0 0-3 0L14 7l3 3 2.5-2.5a2.1 2.1 0 0 0 0-3Z" /><path d="M14 7l-8 8-1.5 4.5L9 18l8-8" /></svg>

function ShapeIco({ shape }) {
  const p = { fill: 'currentColor' }
  if (shape === 'square') return <svg width="16" height="16" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" {...p} /></svg>
  if (shape === 'diamond') return <svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 3l9 9-9 9-9-9 9-9Z" {...p} /></svg>
  if (shape === 'triangle') return <svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 4l9 16H3L12 4Z" {...p} /></svg>
  return <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" {...p} /></svg>
}

const CURSOR_SHAPES = {
  circle: <circle cx="50" cy="50" r="46" />,
  square: <rect x="6" y="6" width="88" height="88" rx="6" />,
  diamond: <path d="M50 4 96 50 50 96 4 50Z" />,
  triangle: <path d="M50 8 94 92 6 92Z" />,
}

// Outline that follows the cursor so you can see the brush footprint.
// White halo + dark line keeps it visible over any colour. Non-scaling stroke
// keeps the outline thin no matter the brush size.
function BrushCursor({ shape, size }) {
  const el = CURSOR_SHAPES[shape] || CURSOR_SHAPES.circle
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <g fill="none" stroke="#ffffff" strokeWidth="4" vectorEffect="non-scaling-stroke">{el}</g>
      <g fill="none" stroke="#1b1b1f" strokeWidth="1.6" vectorEffect="non-scaling-stroke">{el}</g>
    </svg>
  )
}
