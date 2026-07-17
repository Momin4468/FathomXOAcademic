"use client";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * Design-system primitives recreated from `Business OS v5.dc.html` (the handoff).
 * The prototype is LIGHT content on a dark shell, styled with exact hex tokens; we
 * render these with the same tokens (inline styles) so every module screen matches
 * the design 1:1 regardless of the app's theme toggle. Screens compose Page +
 * StatCards + DGrid (the handoff's one "generic grid" that powers most modules).
 */

// ── exact tokens (design_handoff_business_os/README.md · Design Tokens) ───────
export const T = {
  gold: "#E8B64C", goldHover: "#F0D08C", goldDeep: "#B6822A", goldInk: "#070A14",
  ink: "#0E1524", ink2: "#45506A", muted: "#667085", muted2: "#8A93A6",
  canvas: "#F6F7F9", card: "#FFFFFF", border: "#E2E6EC", hair: "#F3F5F8", eyebrow: "#EEF1F5", rowHover: "#FAFBFC",
  navy: "#0B1020", navy2: "#141B33",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  codeBg: "#EEF1F5", codeText: "#26304A",
  parch: "#FBF7EC", parchIn: "#FFFDF6", parchBorder: "#EAD9AE", parchText: "#8A5F1D",
  green: "#157F3D", greenBg: "#E4F3EA", red: "#B42318", redBg: "#FBE9E7",
  amber: "#8A5F1D", amberBg: "#FCF6E8", amberBg2: "#FCF1DC", blue: "#3353C4", blueBg: "#E8EDFB",
  purple: "#6D3FC4", purpleBg: "#F0E9FB",
} as const;

export type Tone = "gray" | "green" | "amber" | "red" | "blue" | "purple" | "gold";
const TONES: Record<Tone, { bg: string; color: string; border: string; labelColor: string }> = {
  gray: { bg: "#F4F6F9", color: T.ink, border: T.border, labelColor: T.muted },
  green: { bg: T.greenBg, color: T.green, border: "#CFEBD9", labelColor: T.green },
  amber: { bg: T.amberBg, color: T.amber, border: "#EAD9AE", labelColor: T.amber },
  red: { bg: T.redBg, color: T.red, border: "#F3C9C3", labelColor: T.red },
  blue: { bg: T.blueBg, color: T.blue, border: "#CBD8F5", labelColor: T.blue },
  purple: { bg: T.purpleBg, color: T.purple, border: "#DDD0F4", labelColor: T.purple },
  gold: { bg: "#FCF6E8", color: T.goldDeep, border: "#EAD9AE", labelColor: T.goldDeep },
};

export const money = (n: number | string | null | undefined, dash = "—") => {
  if (n == null || n === "") return dash;
  const v = Number(n);
  if (!Number.isFinite(v)) return dash;
  return `৳${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};
export const fmtDay = (d?: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return day && m ? `${day}/${m}/${y?.slice(2)}` : d;
};

export const dcInput: CSSProperties = {
  border: `1px solid ${T.border}`, borderRadius: 7, padding: "8px 9px",
  fontSize: 12.5, fontFamily: "Inter, sans-serif", outlineColor: T.gold, background: T.card, width: "100%",
};

// ── Page: Fraunces title + subtitle + optional right action ──────────────────
export function Page({
  title, sub, action, children,
}: { title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ fontFamily: "Inter, sans-serif", color: T.ink }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 24, fontWeight: 600, margin: 0 }}>{title}</h1>
        {sub && <span style={{ fontSize: 12.5, color: T.muted }}>{sub}</span>}
        <div style={{ flex: 1 }} />
        {action}
      </div>
      {children}
    </div>
  );
}

export function GoldButton({ onClick, children, href, type, disabled }: { onClick?: () => void; children: ReactNode; href?: string; type?: "button" | "submit"; disabled?: boolean }) {
  const style: CSSProperties = { fontFamily: "Inter, sans-serif", fontSize: 12.5, fontWeight: 700, padding: "7px 14px", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer", background: T.gold, color: T.goldInk, textDecoration: "none", display: "inline-block", border: "none", opacity: disabled ? 0.5 : 1 };
  if (href) return <Link href={href} style={style}>{children}</Link>;
  if (type) return <button type={type} disabled={disabled} onClick={onClick} style={style}>{children}</button>;
  return <span onClick={disabled ? undefined : onClick} style={style}>{children}</span>;
}
export function GhostButton({ onClick, children, href, type, disabled, danger }: { onClick?: () => void; children: ReactNode; href?: string; type?: "button" | "submit"; disabled?: boolean; danger?: boolean }) {
  const style: CSSProperties = { fontFamily: "Inter, sans-serif", fontSize: 12.5, fontWeight: 700, padding: "7px 14px", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer", background: T.card, color: danger ? T.red : T.ink2, border: `1px solid ${danger ? "#F3C9C3" : T.border}`, textDecoration: "none", display: "inline-block", opacity: disabled ? 0.5 : 1 };
  if (href) return <Link href={href} style={style}>{children}</Link>;
  if (type) return <button type={type} disabled={disabled} onClick={onClick} style={style}>{children}</button>;
  return <span onClick={disabled ? undefined : onClick} style={style}>{children}</span>;
}

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: Tone }) {
  const t = TONES[tone];
  return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 9px", borderRadius: 999, background: t.bg, color: t.color, whiteSpace: "nowrap" }}>{children}</span>;
}

export function Pill({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <span onClick={onClick} style={{ fontSize: 12, fontWeight: 600, padding: "6px 13px", borderRadius: 999, cursor: "pointer", background: active ? T.ink : "transparent", color: active ? "#F0D08C" : T.muted, border: `1px solid ${active ? T.ink : T.border}` }}>
      {children}
    </span>
  );
}

// ── Stat cards row (dashboard + module headers) ──────────────────────────────
export type Stat = { label: string; value: ReactNode; tone?: Tone; note?: string };
export function StatCards({ items, min = 170 }: { items: Stat[]; min?: number }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12, marginBottom: 16 }}>
      {items.map((s, i) => {
        const t = TONES[s.tone ?? "gray"];
        return (
          <div key={i} style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 12, padding: "13px 16px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: t.labelColor }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 4, color: t.color }}>{s.value}</div>
            {s.note && <div style={{ fontSize: 11, color: T.muted2, marginTop: 2 }}>{s.note}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Card + section header (list/detail panels) ───────────────────────────────
export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden", ...style }}>{children}</div>;
}
export function CardHead({ children, tone }: { children: ReactNode; tone?: Tone }) {
  const t = tone ? TONES[tone] : null;
  return <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.eyebrow}`, fontSize: 12, fontWeight: 700, background: t?.bg, color: t?.color ?? T.ink }}>{children}</div>;
}

// ── Form primitives (label/error field, inline banner, loading + empty) ───────
export function Field({ label, hint, error, required, children }: { label: string; hint?: string; error?: string; required?: boolean; children: ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 5 }}>
        {label}{required && <span style={{ color: T.red, marginLeft: 2 }}>*</span>}
      </span>
      {children}
      {hint && !error && <span style={{ display: "block", fontSize: 10.5, color: T.muted2, marginTop: 4 }}>{hint}</span>}
      {error && <span style={{ display: "block", fontSize: 10.5, color: T.red, fontWeight: 600, marginTop: 4 }}>{error}</span>}
    </label>
  );
}
export function Note({ children, tone = "red" }: { children: ReactNode; tone?: Tone }) {
  const t = TONES[tone];
  return <div style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.color, borderRadius: 8, padding: "8px 11px", fontSize: 11.5, fontWeight: 500 }}>{children}</div>;
}
export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div style={{ padding: "22px 0", textAlign: "center", fontSize: 12.5, color: T.muted2 }}>{label}</div>;
}
export function EmptyBox({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ border: `1px dashed ${T.border}`, borderRadius: 12, padding: "34px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: T.ink2 }}>{title}</div>
      {hint && <div style={{ fontSize: 11.5, color: T.muted2, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

// ── DGrid: the handoff's generic module table (config-driven) ────────────────
export type Align = "left" | "right" | "center";
export type DCol<R> = { label: string; align?: Align; width?: number; render: (row: R) => ReactNode };
export type DAction<R> = { label: string; onClick?: (row: R) => void; icon?: ReactNode; color?: string; href?: (row: R) => string };

export function cell(text: ReactNode, opts?: { sub?: ReactNode; mono?: boolean; weight?: number; color?: string; nums?: boolean }): ReactNode {
  return (
    <span>
      <span style={{ fontFamily: opts?.mono ? T.mono : undefined, fontWeight: opts?.weight ?? (opts?.mono ? 600 : undefined), color: opts?.color, fontVariantNumeric: opts?.nums ? "tabular-nums" : undefined, fontSize: opts?.mono ? 11.5 : undefined }}>{text}</span>
      {opts?.sub != null && <span style={{ display: "block", fontSize: 10.5, color: T.muted2 }}>{opts.sub}</span>}
    </span>
  );
}

export function DGrid<R>({
  cols, rows, keyOf, actions, minWidth = 560, empty = "Nothing here yet.", foot,
}: {
  cols: DCol<R>[]; rows: R[]; keyOf: (r: R) => string; actions?: DAction<R>[];
  minWidth?: number; empty?: string; foot?: ReactNode;
}) {
  const th: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: T.muted, padding: "9px 12px", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
  const td: CSSProperties = { padding: "8px 12px", borderBottom: `1px solid ${T.hair}`, verticalAlign: "top" };
  return (
    <>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth, borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={i} style={{ ...th, textAlign: c.align ?? "left", width: c.width }}>{c.label}</th>
              ))}
              {actions && <th style={{ ...th, width: 74 }} />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={cols.length + (actions ? 1 : 0)} style={{ ...td, textAlign: "center", color: T.muted2, padding: "24px 12px" }}>{empty}</td></tr>
            ) : rows.map((r) => (
              <tr key={keyOf(r)} style={{ background: "transparent" }}>
                {cols.map((c, i) => (
                  <td key={i} style={{ ...td, textAlign: c.align ?? "left", fontVariantNumeric: c.align === "right" ? "tabular-nums" : undefined }}>{c.render(r)}</td>
                ))}
                {actions && (
                  <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                    {actions.map((a, i) => a.href ? (
                      <Link key={i} href={a.href(r)} title={a.label} style={{ fontSize: 11, fontWeight: 600, color: a.color ?? T.muted, marginLeft: 8, textDecoration: "none" }}>{a.icon ?? a.label}</Link>
                    ) : (
                      <span key={i} onClick={() => a.onClick?.(r)} title={a.label} style={{ fontSize: 11, fontWeight: 600, color: a.color ?? T.goldDeep, marginLeft: 8, cursor: "pointer" }}>{a.icon ?? a.label}</span>
                    ))}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {foot && <div style={{ fontSize: 11.5, color: T.muted, marginTop: 10 }}>{foot}</div>}
    </>
  );
}
