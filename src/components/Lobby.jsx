import { useState } from 'react'
import { Panel, Eyebrow, Button, Plus, ArrowRight, Link, Sparkle } from './ui'
import { normalizeCode } from '../lib/net'

function Stage({ children }) {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col items-center justify-center px-4 py-16">
      {children}
    </div>
  )
}

export function Lobby({ onCreate, onJoin, error, busy, initialCode = '' }) {
  const [code, setCode] = useState(initialCode)

  return (
    <Stage>
      <div className="rise flex flex-col items-center text-center">
        <Eyebrow>
          <Sparkle size={11} /> P2P · без сервера
        </Eyebrow>
        <h1 className="mt-6 font-display text-[2rem] font-semibold leading-[1.02] tracking-tight text-ink sm:text-6xl sm:leading-[0.95] lg:text-7xl">
          Раскраска
          <span className="bg-[linear-gradient(110deg,#7c3aed,#ec4899)] bg-clip-text text-transparent">
            -дуэль
          </span>
        </h1>
        <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-soft">
          Загрузите фото — оно станет раскраской. Двое красят по блокам на своих
          устройствах, а в конце сравнивают работы бок о бок.
        </p>
      </div>

      <div className="rise mt-12 grid w-full gap-4 sm:grid-cols-2" style={{ animationDelay: '0.1s' }}>
        {/* Create */}
        <Panel>
          <div className="flex h-full flex-col items-start gap-5 p-7">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#7c3aed,#ec4899)] text-white">
              <Plus size={18} />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-ink">Создать комнату</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                Вы — ведущий: выбираете картинку и получаете код для напарника.
              </p>
            </div>
            <Button variant="accent" onClick={onCreate} disabled={busy} icon={<ArrowRight />} className="mt-auto w-full">
              Создать
            </Button>
          </div>
        </Panel>

        {/* Join */}
        <Panel>
          <div className="flex h-full flex-col items-start gap-5 p-7">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink/5 text-ink">
              <Link size={18} />
            </div>
            <div className="w-full">
              <h2 className="font-display text-xl font-semibold text-ink">Войти по коду</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                Введите код из 4 символов, который дал напарник.
              </p>
            </div>
            <input
              value={code}
              onChange={(e) => setCode(normalizeCode(e.target.value))}
              placeholder="К О Д"
              inputMode="text"
              autoCapitalize="characters"
              className="w-full rounded-2xl bg-ink/[0.04] px-5 py-3.5 text-center font-display text-2xl font-semibold tracking-[0.5em] text-ink placeholder:tracking-[0.3em] placeholder:text-mute focus:outline-none focus:ring-2 focus:ring-violet/40"
              onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 4) onJoin(code) }}
            />
            <Button
              variant="soft"
              onClick={() => onJoin(code)}
              disabled={busy || code.length !== 4}
              icon={<ArrowRight />}
              className="mt-auto w-full"
            >
              Войти
            </Button>
          </div>
        </Panel>
      </div>

      {error && (
        <p className="rise mt-6 max-w-md rounded-2xl bg-pink/10 px-5 py-3 text-center text-sm font-medium text-[#b3245f] ring-1 ring-pink/20">
          {error}
        </p>
      )}
    </Stage>
  )
}

export function Waiting({ title, subtitle, code, onShare, children }) {
  return (
    <Stage>
      <Panel className="rise w-full max-w-lg">
        <div className="flex flex-col items-center gap-6 px-8 py-14 text-center">
          <Eyebrow>Комната создана</Eyebrow>
          <h2 className="font-display text-3xl font-semibold text-ink">{title}</h2>
          {code && (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-3xl bg-ink/[0.04] px-10 py-6 ring-1 ring-[color:var(--color-line)]">
                <div className="font-display text-6xl font-semibold tracking-[0.35em] text-ink">{code}</div>
              </div>
              {onShare && (
                <Button variant="soft" onClick={onShare} icon={<Link />}>
                  Поделиться ссылкой
                </Button>
              )}
            </div>
          )}
          <p className="max-w-sm text-sm leading-relaxed text-ink-soft">{subtitle}</p>
          <div className="flex items-center gap-1.5 text-mute">
            <Dot /> <Dot delay="0.15s" /> <Dot delay="0.3s" />
          </div>
          {children}
        </div>
      </Panel>
    </Stage>
  )
}

function Dot({ delay = '0s' }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full bg-current"
      style={{ animation: 'rise 0.9s var(--ease-spring) infinite alternate', animationDelay: delay }}
    />
  )
}

export { Stage }
