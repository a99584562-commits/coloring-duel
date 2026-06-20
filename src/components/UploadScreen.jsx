import { useEffect, useRef, useState } from 'react'
import { Panel, Eyebrow, Button, Upload, Sparkle, ArrowRight } from './ui'
import { CanvasView } from './CanvasView'
import { Stage } from './Lobby'
import { loadImage, downscaleToImageData, buildColoringPage, renderPage } from '../lib/colorize'

// detail level (1..5) → minimum area of a kept zone (higher level = keep more small zones)
const MIN_AREA = [48, 24, 12, 6, 3]

function emptyColors(n) {
  const a = new Int32Array(n)
  a.fill(-1)
  return a
}

export function UploadScreen({ onStart, defaultSrc = null }) {
  const [imageData, setImageData] = useState(null)
  const [threshold, setThreshold] = useState(185)
  const [closeRadius, setCloseRadius] = useState(2)
  const [level, setLevel] = useState(2)
  const [page, setPage] = useState(null)
  const [outline, setOutline] = useState(null)
  const [building, setBuilding] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const buildTimer = useRef(null)

  useEffect(() => {
    if (!defaultSrc) return
    loadImage(defaultSrc).then((image) => setImageData(downscaleToImageData(image)))
  }, [defaultSrc])

  async function pickFile(file) {
    if (!file || !file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    const image = await loadImage(url)
    setImageData(downscaleToImageData(image))
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (!imageData) return
    setBuilding(true)
    clearTimeout(buildTimer.current)
    buildTimer.current = setTimeout(() => {
      const minArea = MIN_AREA[level]
      const p = buildColoringPage(imageData, { threshold, minArea, closeRadius })
      setPage(p)
      setOutline(renderPage(p, emptyColors(p.regionCount)))
      setBuilding(false)
    }, 200)
    return () => clearTimeout(buildTimer.current)
  }, [imageData, threshold, closeRadius, level])

  const ready = page && imageData

  return (
    <Stage>
      <div className="rise w-full max-w-5xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <Eyebrow><Sparkle size={11} /> Шаг 1 — контур</Eyebrow>
          <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            Загрузите контур
          </h1>
          <p className="mt-3 max-w-lg text-[15px] text-ink-soft">
            Лучше всего — чёрно-белый лайн-арт. Приложение найдёт замкнутые области,
            и их можно будет заливать любым цветом. Напарник получит такую же раскраску.
          </p>
        </div>

        <Panel>
          <div className="grid gap-2 p-2 lg:grid-cols-[1.25fr_1fr]">
            <label
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]) }}
              className={`group relative flex min-h-[360px] cursor-pointer items-center justify-center overflow-hidden rounded-[1.4rem] bg-ink/[0.03] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${dragOver ? 'ring-2 ring-violet/50' : 'ring-1 ring-[color:var(--color-line)]'}`}
            >
              <input type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
              {outline ? (
                <>
                  <CanvasView imageData={outline} className="max-h-[68vh] w-auto max-w-full object-contain p-2" />
                  <div className={`pointer-events-none absolute inset-0 bg-white/40 backdrop-blur-sm transition-opacity duration-300 ${building ? 'opacity-100' : 'opacity-0'}`} />
                  <span className="absolute bottom-3 left-3 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-ink-soft ring-1 ring-[color:var(--color-line)]">
                    {building ? 'Считаю…' : `${page.regionCount} зон`}
                  </span>
                  <span className="absolute bottom-3 right-3 rounded-full bg-ink/80 px-3 py-1 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                    сменить
                  </span>
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 text-mute">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-ink ring-1 ring-[color:var(--color-line)]">
                    <Upload size={20} />
                  </div>
                  <p className="text-sm font-medium text-ink-soft">Перетащите контур сюда</p>
                  <p className="text-xs">или нажмите, чтобы выбрать</p>
                </div>
              )}
            </label>

            <div className="flex flex-col gap-6 rounded-[1.4rem] bg-white/70 p-7">
              <Slider
                label="Против затёков"
                value={closeRadius}
                min={0}
                max={5}
                onChange={setCloseRadius}
                disabled={!imageData}
                hint="закрывает разрывы в контуре, чтобы заливка не вытекала"
              />
              <Slider
                label="Чувствительность линий"
                value={threshold}
                min={130}
                max={235}
                step={5}
                onChange={setThreshold}
                disabled={!imageData}
                hint="выше — толще линии и плотнее контур"
              />
              <Slider
                label="Мелкие детали"
                value={level + 1}
                min={1}
                max={5}
                onChange={(v) => setLevel(v - 1)}
                disabled={!imageData}
                hint={['убрать мелочь', '', 'баланс', '', 'сохранить всё'][level]}
              />

              <div className="mt-auto flex flex-col gap-3 pt-4">
                <p className="text-xs leading-relaxed text-mute">
                  Превью слева — это и есть раскраска. Если соседние области сливаются —
                  поднимите чувствительность; если линий слишком много — опустите.
                </p>
                <Button
                  variant="accent"
                  disabled={!ready || building}
                  icon={<ArrowRight />}
                  onClick={() => onStart({ imageData, page, threshold, minArea: MIN_AREA[level], closeRadius })}
                  className="w-full"
                >
                  Начать красить
                </Button>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </Stage>
  )
}

function Slider({ label, value, min, max, step = 1, onChange, disabled, hint }) {
  return (
    <div className={disabled ? 'opacity-40' : ''}>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span className="font-display text-lg font-semibold text-violet">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="duel-range w-full"
      />
      {hint && <p className="mt-1.5 text-xs text-mute">{hint}</p>}
    </div>
  )
}

export function WaitImage() {
  return (
    <Stage>
      <Panel className="rise w-full max-w-lg">
        <div className="flex flex-col items-center gap-6 px-8 py-16 text-center">
          <Eyebrow><Sparkle size={11} /> Подключено</Eyebrow>
          <h2 className="font-display text-3xl font-semibold text-ink">Напарник выбирает контур…</h2>
          <p className="max-w-sm text-sm leading-relaxed text-ink-soft">
            Как только он нажмёт «Начать красить», у вас появится та же раскраска.
          </p>
          <div className="h-1.5 w-44 overflow-hidden rounded-full bg-ink/5">
            <div className="h-full w-1/3 rounded-full bg-[linear-gradient(90deg,#7c3aed,#ec4899)]" style={{ animation: 'slide 1.4s var(--ease-spring) infinite' }} />
          </div>
        </div>
      </Panel>
    </Stage>
  )
}
