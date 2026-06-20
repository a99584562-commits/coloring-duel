// Shared premium UI atoms (double-bezel panels, island buttons, line icons).

const SPRING = 'ease-[cubic-bezier(0.32,0.72,0,1)]'

export function Panel({ children, className = '', innerClassName = '' }) {
  return (
    <div className={`rounded-[2rem] bg-white/40 p-1.5 ring-1 ring-[color:var(--color-line)] backdrop-blur-xl ${className}`}>
      <div className={`rounded-[calc(2rem-0.375rem)] bg-white/80 shadow-[inset_0_1px_1px_rgba(255,255,255,0.65)] ${innerClassName}`}>
        {children}
      </div>
    </div>
  )
}

export function Eyebrow({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full bg-white/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-soft ring-1 ring-[color:var(--color-line)] ${className}`}>
      {children}
    </span>
  )
}

export function Button({
  children,
  onClick,
  icon,
  variant = 'primary',
  className = '',
  disabled = false,
  type = 'button',
}) {
  const base = `group inline-flex select-none items-center justify-center gap-3 rounded-full px-6 py-3.5 text-[15px] font-semibold transition-all duration-500 ${SPRING} active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40`
  const variants = {
    primary:
      'bg-ink text-white shadow-[0_18px_44px_-18px_rgba(20,16,31,0.55)] hover:shadow-[0_26px_55px_-16px_rgba(124,58,237,0.5)]',
    accent:
      'text-white shadow-[0_18px_44px_-16px_rgba(124,58,237,0.6)] hover:shadow-[0_26px_55px_-14px_rgba(236,72,153,0.55)] bg-[linear-gradient(110deg,#7c3aed,#ec4899)]',
    soft: 'bg-white/70 text-ink ring-1 ring-[color:var(--color-line)] backdrop-blur hover:bg-white',
    ghost: 'text-ink-soft hover:text-ink',
  }
  const bubble = variant === 'soft' || variant === 'ghost' ? 'bg-ink/5 text-ink' : 'bg-white/15 text-white'
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      <span>{children}</span>
      {icon && (
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-500 ${SPRING} group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105 ${bubble}`}
        >
          {icon}
        </span>
      )}
    </button>
  )
}

// ---- ultra-light line icons (1.5 stroke, rounded) --------------------------

const ico = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const ArrowRight = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...ico}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
export const Plus = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...ico}><path d="M12 5v14M5 12h14" /></svg>
)
export const Check = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...ico}><path d="M4 12.5l5 5 11-11" /></svg>
)
export const Eye = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...ico}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="2.5" /></svg>
)
export const Undo = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...ico}><path d="M9 7 4 12l5 5" /><path d="M4 12h11a5 5 0 0 1 0 10h-1" /></svg>
)
export const Sparkle = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...ico}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4" /></svg>
)
export const Upload = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...ico}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
)
export const Link = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...ico}><path d="M9 15l6-6" /><path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1M13 18l-1 1a4 4 0 0 1-6-6l1-1" /></svg>
)
export const Refresh = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...ico}><path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2" /><path d="M20 4v5h-5M4 20v-5h5" /></svg>
)
