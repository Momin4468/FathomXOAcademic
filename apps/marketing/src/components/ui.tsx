import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** Centered max-width container. */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("mx-auto w-full max-w-container px-5 sm:px-8", className)}>{children}</div>;
}

/** A page section with consistent vertical rhythm + an optional id anchor. */
export function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cx("scroll-mt-20 py-20 sm:py-28", className)}>
      <Container>{children}</Container>
    </section>
  );
}

/** Small uppercase eyebrow label above a heading. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">{children}</p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  intro,
  center,
}: {
  eyebrow?: string;
  title: ReactNode;
  intro?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={cx("max-w-2xl", center && "mx-auto text-center")}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="text-balance text-3xl font-semibold leading-tight sm:text-4xl">{title}</h2>
      {intro && <p className="mt-4 text-lg leading-relaxed text-slate-300">{intro}</p>}
    </div>
  );
}

type BtnVariant = "gold" | "outline" | "ghost";
const BTN: Record<BtnVariant, string> = {
  gold: "bg-gold-400 text-ink-950 hover:bg-gold-300 shadow-glow",
  outline: "border border-gold-400/50 text-gold-300 hover:border-gold-400 hover:bg-gold-400/10",
  ghost: "text-slate-200 hover:text-white hover:bg-white/5",
};
const BTN_BASE =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold tracking-wide transition focus-visible:outline-none";

export function Button({
  variant = "gold",
  href,
  external,
  className,
  children,
  ...rest
}: {
  variant?: BtnVariant;
  href?: string;
  external?: boolean;
  className?: string;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement> &
  AnchorHTMLAttributes<HTMLAnchorElement>) {
  const cls = cx(BTN_BASE, BTN[variant], className);
  if (href) {
    return (
      <a
        href={href}
        className={cls}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {children}
      </a>
    );
  }
  return (
    <button className={cls} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  );
}

/** A bordered, slightly-raised surface on the ink base. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        "rounded-2xl border border-white/10 bg-ink-850/60 p-6 shadow-card backdrop-blur-sm hairline",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
      {children}
    </span>
  );
}
