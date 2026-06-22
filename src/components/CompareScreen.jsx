import { useMemo } from 'react'
import { Panel, Eyebrow, Button, Refresh, Sparkle } from './ui'
import { CanvasView } from './CanvasView'
import { renderOriginal, imageDataToDataURL } from '../lib/colorize'

function triggerDownload(src, name) {
  const a = document.createElement('a')
  a.href = src
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

const DownloadIco = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4v11M8 11l4 4 4-4" />
    <path d="M5 19h14" />
  </svg>
)

function DownloadBtn({ src, name }) {
  return (
    <button
      onClick={() => triggerDownload(src, name)}
      className="mx-auto inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-semibold text-ink ring-1 ring-[color:var(--color-line)] transition-colors hover:bg-white active:scale-[0.98]"
    >
      <DownloadIco /> Скачать
    </button>
  )
}

function Card({ label, accent, children, caption, downloadSrc, downloadName }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-center">
        <Eyebrow className={accent ? '!bg-[linear-gradient(110deg,#7c3aed,#ec4899)] !text-white !ring-0' : ''}>{label}</Eyebrow>
      </div>
      <Panel className={accent ? 'ring-2 ring-violet/30' : ''}>
        <div className="flex items-center justify-center p-2">{children}</div>
      </Panel>
      {downloadSrc
        ? <DownloadBtn src={downloadSrc} name={downloadName} />
        : caption ? <p className="text-center text-xs text-mute">{caption}</p> : null}
    </div>
  )
}

export function CompareScreen({ page, mineSrc, partnerSrc, role, onRestart, onExit, isDemo }) {
  const original = useMemo(() => renderOriginal(page), [page])
  const originalSrc = useMemo(() => imageDataToDataURL(original), [original])

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-6xl px-4 py-12">
      <div className="rise mb-10 flex flex-col items-center text-center">
        <Eyebrow><Sparkle size={11} /> Готово</Eyebrow>
        <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">Сравниваем работы</h1>
        <p className="mt-3 max-w-md text-[15px] text-ink-soft">Оригинальный контур — в центре. Слева ваша раскраска, справа — напарника. Каждую работу можно скачать отдельно.</p>
      </div>

      <div className="rise grid items-start gap-6 md:grid-cols-3" style={{ animationDelay: '0.1s' }}>
        <Card label="Ты" downloadSrc={mineSrc} downloadName="раскраска-я.png">
          {mineSrc
            ? <img src={mineSrc} alt="моя раскраска" className="block w-full rounded-[1.4rem]" />
            : <div className="flex aspect-[3/4] w-full items-center justify-center text-sm text-mute">—</div>}
        </Card>
        <Card label="Контур" accent caption="что закрашивали">
          <CanvasView imageData={original} className="block w-full rounded-[1.4rem]" />
        </Card>
        {partnerSrc
          ? (
            <Card label="Напарник" downloadSrc={partnerSrc} downloadName="раскраска-напарник.png">
              <img src={partnerSrc} alt="раскраска напарника" className="block w-full rounded-[1.4rem]" />
            </Card>
          )
          : (
            <Card label="Напарник">
              <div className="flex aspect-[3/4] w-full items-center justify-center text-sm text-mute">ждём работу напарника…</div>
            </Card>
          )}
      </div>

      <div className="rise mt-12 flex flex-col items-center gap-3" style={{ animationDelay: '0.2s' }}>
        {isDemo || role === 'host' ? (
          <Button variant="accent" icon={<Refresh />} onClick={onRestart}>Новый раунд</Button>
        ) : (
          <p className="text-sm text-ink-soft">Ждём, пока ведущий начнёт новый раунд…</p>
        )}
        <button onClick={() => triggerDownload(originalSrc, 'контур.png')} className="text-sm font-medium text-mute transition-colors hover:text-ink">
          Скачать пустой контур
        </button>
        <button onClick={onExit} className="text-sm font-medium text-mute transition-colors hover:text-ink">Выйти</button>
      </div>
    </div>
  )
}
