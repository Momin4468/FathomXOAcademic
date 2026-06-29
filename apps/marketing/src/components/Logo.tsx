/** The X-Factor mark — a gold "X" with a scholar's star, on the ink base. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} role="img" aria-label="X-Factor mark" fill="none">
      <defs>
        <linearGradient id="xf-gold" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F6E2B3" />
          <stop offset="0.55" stopColor="#E8B64C" />
          <stop offset="1" stopColor="#B6822A" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="39" height="39" rx="10" stroke="#283153" />
      <path d="M11 11 L29 29 M29 11 L11 29" stroke="url(#xf-gold)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M20 5.5 l1.1 2.6 2.8.2 -2.1 1.8 .7 2.7 -2.4-1.5 -2.4 1.5 .7-2.7 -2.1-1.8 2.8-.2 Z" fill="#E8B64C" />
    </svg>
  );
}

/** Full lockup: mark + wordmark. `compact` hides the subtitle. */
export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className="h-9 w-9" />
      <span className="leading-none">
        <span className="block font-display text-lg font-semibold tracking-tight text-slate-100">
          X-Factor
        </span>
        {!compact && (
          <span className="block text-[10px] font-medium uppercase tracking-[0.22em] text-gold-400/90">
            Academic Solutions
          </span>
        )}
      </span>
    </span>
  );
}
