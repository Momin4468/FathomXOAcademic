"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { sanitizeAmount, displayAmount } from "@/lib/format";

/**
 * Personal-Finance design primitives — the TEAL sibling of `dc.tsx`.
 *
 * The PF plane is a walled-off, visibly-PRIVATE plane with its OWN identity: a
 * private teal (never the business gold/navy). These recreate the "PERSONAL FINANCE
 * (walled-off plane)" screen from `Business OS v5.dc.html` (l.817–980) 1:1 using the
 * exact hex tokens from the README (Personal-Finance plane). They sit on top of the
 * existing `PfShell` (dark teal header) and its own PF session/data layer — no
 * business ↔ PF crossing. Cards are the same white surfaces as the business side;
 * only the accent, buttons, chart bars and tints switch to teal.
 */

// ── exact PF tokens (README · Design Tokens · Personal-Finance plane) ─────────
export const PF = {
  grad1: "#0B3B33", grad2: "#0E5C50",
  accent: "#0E5C50", accentHover: "#12776A", accentDeep: "#0E7C6B",
  light: "#7FE3CE", lightChip: "rgba(127,227,206,0.16)",
  onGrad: "#EAF7F3", onGradSub: "#A9D8CC",
  // card surfaces (shared with the business side — a private plane, not a re-theme of white)
  card: "#FFFFFF", canvas: "#F6F7F9", border: "#E2E6EC", hair: "#F3F5F8", eyebrow: "#EEF1F5", rowHover: "#FAFBFC",
  text: "#0E1524", text2: "#45506A", muted: "#667085", muted2: "#8A93A6", faint: "#A8B0BF",
  // chart
  barIn: "#0E7C6B", barOut: "#9AD8C9", track: "#EEF2F1",
  // semantic
  green: "#157F3D", greenBg: "#E9F7F0", greenBorder: "#BBE4D2",
  red: "#B42318", redBg: "#FCECEA", redBorder: "#F0C8C1",
  amber: "#8A5F1D", amberBg: "#FCF6E8", amberBorder: "#EAD9AE",
  blue: "#3353C4", blueBg: "#E8EDFB", blueBorder: "#CBD8F5",
  purple: "#6D3FC4", purpleBg: "#F0E9FB", purpleBorder: "#DDD0F4",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

// account-type tints (README): mobile / bank / cash / crypto
export const PF_TINTS: Record<string, { tint: string; ink: string }> = {
  mobile: { tint: "#FCE9D6", ink: "#B4691A" },
  bank: { tint: "#E8EDFB", ink: "#3353C4" },
  cash: { tint: "#E4F3EA", ink: "#157F3D" },
  crypto: { tint: "#EDE7FB", ink: "#6D3FC4" },
};

/** Note colour → left-strip hex (teal-plane palette; replaces the tailwind class map). */
export const NOTE_STRIP: Record<string, string> = {
  default: "#E2E6EC", yellow: "#F5C24B", green: "#6EDBB2", blue: "#8FB6F5", pink: "#EC9FC4", gray: "#9AA4BD",
};

export type PfTone = "teal" | "green" | "red" | "gray" | "amber" | "blue" | "purple";
const PF_TONES: Record<PfTone, { bg: string; color: string; border: string; labelColor: string }> = {
  teal: { bg: "#E9F6F2", color: PF.accentDeep, border: PF.greenBorder, labelColor: PF.accentDeep },
  green: { bg: PF.greenBg, color: PF.green, border: PF.greenBorder, labelColor: PF.green },
  red: { bg: PF.redBg, color: PF.red, border: PF.redBorder, labelColor: PF.red },
  gray: { bg: "#F4F6F9", color: PF.text, border: PF.border, labelColor: PF.muted },
  amber: { bg: PF.amberBg, color: PF.amber, border: PF.amberBorder, labelColor: PF.amber },
  blue: { bg: PF.blueBg, color: PF.blue, border: PF.blueBorder, labelColor: PF.blue },
  purple: { bg: PF.purpleBg, color: PF.purple, border: PF.purpleBorder, labelColor: PF.purple },
};

// ── Page header (teal-legible on the PfShell dark main) ───────────────────────
export function PfPage({ title, sub, action, children }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ fontFamily: "Inter, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, fontWeight: 600, margin: 0, color: PF.onGrad }}>{title}</h1>
          {sub && <div style={{ fontSize: 12, color: PF.onGradSub, marginTop: 3 }}>{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── The private-plane hero banner (design l.820–824) ──────────────────────────
export function PfBanner() {
  return (
    <div style={{ background: `linear-gradient(120deg, ${PF.grad1}, ${PF.grad2})`, borderRadius: 14, padding: "18px 22px", marginBottom: 16, color: PF.onGrad, display: "flex", alignItems: "center", gap: 14 }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={PF.light} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3l7 3v6c0 5-7 9-7 9s-7-4-7-9V6z M9 12l2 2 4-4" />
      </svg>
      <span style={{ flex: 1 }}>
        <span style={{ display: "block", fontFamily: "Fraunces, Georgia, serif", fontSize: 19, fontWeight: 600 }}>Personal finance</span>
        <span style={{ display: "block", fontSize: 12, color: PF.onGradSub, marginTop: 2 }}>A private plane — separate login, separate data. Invisible even to SuperAdmin. This is the guarantee we&rsquo;ll one day sell.</span>
      </span>
      <span style={{ fontSize: 10.5, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: PF.lightChip, color: PF.light, whiteSpace: "nowrap" }}>🔒 Private</span>
    </div>
  );
}

// ── Buttons ───────────────────────────────────────────────────────────────────
type BtnVariant = "solid" | "ghost" | "secondary" | "danger";
export function PfBtn({ variant = "solid", onClick, children, href, type, disabled }: { variant?: BtnVariant; onClick?: () => void; children: ReactNode; href?: string; type?: "button" | "submit"; disabled?: boolean }) {
  const base: CSSProperties = { fontFamily: "Inter, sans-serif", fontSize: 12.5, fontWeight: 700, padding: "7px 14px", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer", textDecoration: "none", display: "inline-block", border: "none", opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap" };
  const skin: Record<BtnVariant, CSSProperties> = {
    solid: { background: PF.accent, color: PF.onGrad },
    ghost: { background: PF.card, color: PF.accent, border: `1px solid ${PF.accent}` },
    secondary: { background: PF.card, color: PF.text2, border: `1px solid ${PF.border}` },
    danger: { background: PF.card, color: PF.red, border: `1px solid ${PF.redBorder}` },
  };
  const style = { ...base, ...skin[variant] };
  if (href) return <Link href={href} style={style}>{children}</Link>;
  if (type) return <button type={type} disabled={disabled} onClick={onClick} style={style}>{children}</button>;
  return <span onClick={disabled ? undefined : onClick} style={style}>{children}</span>;
}

/** Small inline text action (reverse / archive / delete / remove). */
export function PfTextBtn({ onClick, children, danger, ariaLabel }: { onClick?: () => void; children: ReactNode; danger?: boolean; ariaLabel?: string }) {
  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11, fontWeight: 600, color: danger ? PF.red : PF.accentDeep, fontFamily: "Inter, sans-serif" }}>
      {children}
    </button>
  );
}

// ── Cards ─────────────────────────────────────────────────────────────────────
export function PfCard({ children, style, tone }: { children: ReactNode; style?: CSSProperties; tone?: PfTone }) {
  const t = tone ? PF_TONES[tone] : null;
  return <div style={{ background: t?.bg ?? PF.card, border: `1px solid ${t?.border ?? PF.border}`, borderRadius: 12, padding: 16, ...style }}>{children}</div>;
}
export function PfCardHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: PF.text }}>{children}</div>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}

// ── Stat cards ─────────────────────────────────────────────────────────────────
export type PfStat = { label: string; value: ReactNode; tone?: PfTone; note?: string };
export function PfStatCards({ items, min = 150 }: { items: PfStat[]; min?: number }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12, marginBottom: 16 }}>
      {items.map((s, i) => {
        const t = PF_TONES[s.tone ?? "gray"];
        return (
          <div key={i} style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: t.labelColor }}>{s.label}</div>
            <div style={{ fontSize: 21, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 4, color: t.color }}>{s.value}</div>
            {s.note && <div style={{ fontSize: 11, color: PF.muted2, marginTop: 2 }}>{s.note}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Badge / pill ────────────────────────────────────────────────────────────────
export function PfBadge({ children, tone = "gray" }: { children: ReactNode; tone?: PfTone }) {
  const t = PF_TONES[tone];
  return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 9px", borderRadius: 999, background: t.bg, color: t.color, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.02em" }}>{children}</span>;
}

// ── Form primitives (light, teal focus) ──────────────────────────────────────
export const pfInputStyle: CSSProperties = {
  border: `1px solid ${PF.border}`, borderRadius: 7, padding: "8px 10px",
  fontSize: 12.5, fontFamily: "Inter, sans-serif", outlineColor: PF.accentDeep, background: PF.card, color: PF.text, width: "100%",
};

export function PfField({ label, hint, error, required, children }: { label: string; hint?: string; error?: string; required?: boolean; children: ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: PF.muted, marginBottom: 5 }}>
        {label}{required && <span style={{ color: PF.red, marginLeft: 2 }}>*</span>}
      </span>
      {children}
      {hint && !error && <span style={{ display: "block", fontSize: 10.5, color: PF.muted2, marginTop: 4 }}>{hint}</span>}
      {error && <span style={{ display: "block", fontSize: 10.5, color: PF.red, fontWeight: 600, marginTop: 4 }}>{error}</span>}
    </label>
  );
}

export function PfInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { style, ...rest } = props;
  return <input {...rest} style={{ ...pfInputStyle, ...style }} />;
}
export function PfSelect({ children, style, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} style={{ ...pfInputStyle, ...style }}>{children}</select>;
}
export function PfDateInput({ value, onChange, style }: { value: string; onChange: (v: string) => void; style?: CSSProperties }) {
  return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} style={{ ...pfInputStyle, ...style }} />;
}

/**
 * Light money input — reuses the shared sanitize/format helpers so behaviour is
 * identical to the business `MoneyInput` (no spinners, thousand-separators on blur,
 * emits a bare numeric string). Only the skin is teal/light.
 */
export function PfMoneyInput({ value, onChange, currency = "BDT", allowNegative = false, required }: { value: string; onChange: (v: string) => void; currency?: string; allowNegative?: boolean; required?: boolean }) {
  const [text, setText] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(value ?? ""); }, [value, focused]);
  const display = focused ? text : displayAmount(text);
  const symbol = ({ BDT: "৳", USD: "$", GBP: "£", EUR: "€", AUD: "A$" } as Record<string, string>)[currency] ?? currency;
  return (
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 10, top: 0, bottom: 0, display: "flex", alignItems: "center", fontSize: 12.5, color: PF.muted, pointerEvents: "none" }}>{symbol}</span>
      <input
        type="text" inputMode="decimal" required={required} value={display}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={(e) => { const t = sanitizeAmount(e.target.value, allowNegative); setText(t); onChange(t); }}
        style={{ ...pfInputStyle, paddingLeft: 24, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
      />
    </div>
  );
}

/** Teal switch (settings). */
export function PfToggle({ label, desc, on, onChange }: { label: string; desc?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: PF.text }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: PF.muted, marginTop: 1 }}>{desc}</div>}
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} style={{ position: "relative", marginTop: 2, height: 22, width: 40, flexShrink: 0, borderRadius: 999, border: "none", cursor: "pointer", background: on ? PF.accent : "#D3DAE3", transition: "background .15s" }}>
        <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, height: 18, width: 18, borderRadius: 999, background: "#FFFFFF", transition: "left .15s" }} />
      </button>
    </div>
  );
}

// ── States ─────────────────────────────────────────────────────────────────────
export function PfLoading({ label = "Loading…" }: { label?: string }) {
  return <div style={{ padding: "22px 0", textAlign: "center", fontSize: 12.5, color: PF.onGradSub }}>{label}</div>;
}
export function PfEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ border: `1px dashed ${PF.border}`, borderRadius: 12, padding: "34px 16px", textAlign: "center", background: PF.card }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: PF.text2 }}>{title}</div>
      {hint && <div style={{ fontSize: 11.5, color: PF.muted2, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
export function PfNote({ children, tone = "red" }: { children: ReactNode; tone?: PfTone }) {
  const t = PF_TONES[tone];
  return <div style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.color, borderRadius: 8, padding: "8px 11px", fontSize: 11.5, fontWeight: 500 }}>{children}</div>;
}

// ── Charts ─────────────────────────────────────────────────────────────────────
/** 6-month income-vs-spend grouped bars (design l.849–860). */
export function PfIncomeSpendBars({ series }: { series: Array<{ label: string; income: number; expense: number }> }) {
  const max = Math.max(1, ...series.flatMap((m) => [m.income, m.expense]));
  const h = (v: number) => `${Math.max(2, Math.round((v / max) * 100))}%`;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 140 }}>
        {series.map((m, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: "100%", width: "100%", justifyContent: "center" }}>
              <div title={`Income ${m.income}`} style={{ width: 13, height: h(m.income), background: PF.barIn, borderRadius: "3px 3px 0 0" }} />
              <div title={`Spend ${m.expense}`} style={{ width: 13, height: h(m.expense), background: PF.barOut, borderRadius: "3px 3px 0 0" }} />
            </div>
            <span style={{ fontSize: 10.5, color: PF.muted2 }}>{m.label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 11, color: PF.muted }}>
        <span><span style={{ display: "inline-block", width: 9, height: 9, background: PF.barIn, borderRadius: 2, marginRight: 4 }} />Income</span>
        <span><span style={{ display: "inline-block", width: 9, height: 9, background: PF.barOut, borderRadius: 2, marginRight: 4 }} />Spend</span>
      </div>
    </div>
  );
}

/** Spending-by-category track bars (design l.865). */
export function PfCategoryBars({ rows }: { rows: Array<{ name: string; amount: ReactNode; pct: number }> }) {
  return (
    <div>
      {rows.map((c, i) => (
        <div key={i} style={{ marginBottom: 11 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: PF.text2 }}>{c.name}</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{c.amount}</span>
          </div>
          <div style={{ height: 7, background: PF.track, borderRadius: 999, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, c.pct))}%`, background: PF.accentDeep, borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A single progress track (savings pot / target). */
export function PfProgress({ pct, over }: { pct: number; over?: boolean }) {
  return (
    <div style={{ height: 7, width: "100%", background: PF.track, borderRadius: 999, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`, background: over ? PF.red : PF.accentDeep, borderRadius: 999 }} />
    </div>
  );
}

// ── Icons (edit / trash) ─────────────────────────────────────────────────────
export function PfIcon({ name, color, size = 14 }: { name: "edit" | "trash"; color?: string; size?: number }) {
  const d = name === "edit" ? "M4 20h4L18 10l-4-4L4 16z M13 5l4 4" : "M4 7h16 M6 7l1 13h10l1-13 M9 7V4h6v3";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? PF.text2} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
