/**
 * The X-Factor AS lockup for the internal tool — the SAME gold "X + scholar's star"
 * mark as the marketing site (ported verbatim from apps/marketing/src/components/Logo.tsx,
 * not redrawn), with the "X-Factor AS" wordmark.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} role="img" aria-label="X-Factor AS mark" fill="none">
      <defs>
        <linearGradient id="xfas-gold" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F6E2B3" />
          <stop offset="0.55" stopColor="#E8B64C" />
          <stop offset="1" stopColor="#B6822A" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="39" height="39" rx="10" stroke="#283153" />
      <path d="M11 11 L29 29 M29 11 L11 29" stroke="url(#xfas-gold)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M20 5.5 l1.1 2.6 2.8.2 -2.1 1.8 .7 2.7 -2.4-1.5 -2.4 1.5 .7-2.7 -2.1-1.8 2.8-.2 Z" fill="#E8B64C" />
    </svg>
  );
}

/**
 * Full lockup: mark + wordmark. `compact` hides the subtitle. `onDark` forces a
 * fixed light wordmark for the always-dark sidebar/header; without it the wordmark
 * follows the content theme (dark text on the light login/content, light in dark).
 */
export function Logo({ compact, onDark }: { compact?: boolean; onDark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className="h-8 w-8" />
      <span className="leading-none">
        <span className={`block font-display text-base font-semibold tracking-tight ${onDark ? "text-nav-bright" : "text-slate-100"}`}>
          X-Factor AS
        </span>
        {!compact && (
          <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-gold-400/90">
            Academic
          </span>
        )}
      </span>
    </span>
  );
}
