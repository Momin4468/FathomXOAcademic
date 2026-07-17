"use client";
import { useState } from "react";
import { pfApiSend, usePfApi } from "@/lib/pf-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import type { PfCategory } from "@/lib/pf-types";
import { PfShell } from "@/components/PfShell";
import { useConfirm } from "@/components/confirm";
import { PF, PfBtn, PfCard, PfField, PfInput, PfSelect, PfBadge, PfNote, PfLoading, PfEmpty, PfTextBtn } from "@/components/pf-dc";

export default function PfCategoriesPage() {
  const confirm = useConfirm();
  const { data, error, isLoading, mutate } = usePfApi<PfCategory[]>("categories");
  const [form, setForm] = useState({ kind: "expense", name: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await pfApiSend("categories", "POST", { kind: form.kind, name: form.name.trim() });
      setForm({ ...form, name: "" });
      await mutate();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not add") ?? "");
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    if (!(await confirm({ title: "Archive this category?", danger: true, confirmLabel: "Archive" }))) return;
    await pfApiSend(`categories/${id}/archive`, "POST");
    await mutate();
  }

  const th: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: PF.muted, padding: "9px 14px", borderBottom: `1px solid ${PF.border}`, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "9px 14px", borderBottom: `1px solid ${PF.hair}`, verticalAlign: "middle" };

  return (
    <PfShell>
      <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, fontWeight: 600, margin: 0, color: PF.onGrad }}>Categories</h1>
      <p style={{ fontSize: 12, color: PF.onGradSub, margin: "4px 0 16px" }}>Your own income &amp; expense categories — add, rename, or archive freely.</p>

      <PfCard style={{ marginBottom: 16 }}>
        <form onSubmit={add} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div style={{ width: 150 }}><PfField label="Type" error={fieldErrs.kind}><PfSelect value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="income">income</option><option value="expense">expense</option></PfSelect></PfField></div>
          <div style={{ flex: 1, minWidth: 160 }}><PfField label="Name" error={fieldErrs.name}><PfInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Groceries" /></PfField></div>
          <PfBtn type="submit" disabled={busy || !form.name.trim()}>{busy ? "Adding…" : "Add"}</PfBtn>
        </form>
        {err && <div style={{ marginTop: 8 }}><PfNote tone="red">{err}</PfNote></div>}
      </PfCard>

      {isLoading && <PfLoading />}
      {error && <PfNote tone="red">{error.message}</PfNote>}
      {data && data.length === 0 && <PfEmpty title="No categories yet" />}
      {data && data.length > 0 && (
        <div style={{ background: PF.card, border: `1px solid ${PF.border}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 360, borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Name</th>
                <th style={{ ...th, textAlign: "center" }}>Type</th>
                <th style={{ ...th, width: 70 }} />
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td style={{ ...td, fontWeight: 500, color: PF.text }}>{c.name}</td>
                  <td style={{ ...td, textAlign: "center" }}><PfBadge tone={c.kind === "income" ? "green" : "gray"}>{c.kind}</PfBadge></td>
                  <td style={{ ...td, textAlign: "right" }}><PfTextBtn danger ariaLabel="Archive category" onClick={() => archive(c.id)}>archive</PfTextBtn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PfShell>
  );
}
