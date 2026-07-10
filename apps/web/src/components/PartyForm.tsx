"use client";
import { useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import type { PartyRow, RefEntity } from "@/lib/types";
import { EntityPicker, type PickItem } from "./EntityPicker";
import { Button, ErrorNote, Field, Input, cx } from "./ui";

/**
 * Create/edit a party (client / writer / vendor / partner / referrer / employee).
 * Reused by the Clients directory and the general People directory (Phase 3 —
 * closes the reference/master-data CRUD gap). Posts to the existing
 * `POST /parties` / `PATCH /parties/:id` — no new endpoint. A party is never hard
 * deleted (it's referenced by the money ledger); it's edited or left in place.
 */
const PARTY_TYPE_OPTIONS = ["client", "writer", "vendor", "referrer", "partner", "employee"] as const;

const searchUniversity = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<RefEntity[]>(`reference?kind=university&q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.canonical, sub: r.status }));
};
const createUniversity = async (raw: string): Promise<PickItem> => {
  const res = await apiSend<{ entity: RefEntity }>("reference/resolve", "POST", { kind: "university", raw });
  return { id: res.entity.id, label: res.entity.canonical };
};

export interface PartyFormInitial {
  id: string;
  displayName: string;
  partyType: string[];
  externalRef: string | null;
  universityId: string | null;
  programme: string | null;
  contact?: Record<string, unknown> | null;
}

export function PartyForm({
  initial,
  presetType,
  onSaved,
  onCancel,
}: {
  initial?: PartyFormInitial;
  /** Default-checked type for a NEW party (e.g. "client" on the Clients page). */
  presetType?: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const editing = !!initial;
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [types, setTypes] = useState<string[]>(initial?.partyType ?? (presetType ? [presetType] : []));
  const [externalRef, setExternalRef] = useState(initial?.externalRef ?? "");
  const [universityId, setUniversityId] = useState<string | null>(initial?.universityId ?? null);
  const [programme, setProgramme] = useState(initial?.programme ?? "");
  const [email, setEmail] = useState((initial?.contact?.email as string | undefined) ?? "");
  const [phone, setPhone] = useState((initial?.contact?.phone as string | undefined) ?? "");
  const [error, setError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const toggleType = (t: string) =>
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return;
    setBusy(true);
    setError("");
    setFieldErrs({});
    const contact: Record<string, string> = {};
    if (email.trim()) contact.email = email.trim();
    if (phone.trim()) contact.phone = phone.trim();
    const body = {
      displayName: displayName.trim(),
      partyType: types.length ? types : undefined,
      externalRef: externalRef.trim() || undefined,
      universityId: universityId ?? undefined,
      programme: programme.trim() || undefined,
      contact: Object.keys(contact).length ? contact : undefined,
    };
    try {
      if (editing) await apiSend<PartyRow>(`parties/${initial!.id}`, "PATCH", body);
      else await apiSend<PartyRow>("parties", "POST", body);
      onSaved();
    } catch (err) {
      setFieldErrs(fieldErrorMap(err));
      setError(bannerMessage(err, "Could not save") ?? "");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Name" required error={fieldErrs.displayName}>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Full name" required />
      </Field>

      <div>
        <span className="mb-1 block text-sm font-medium text-slate-300">Type(s)</span>
        <div className="flex flex-wrap gap-1.5">
          {PARTY_TYPE_OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              aria-pressed={types.includes(t)}
              className={cx(
                "rounded-full border px-3 py-1 text-xs capitalize",
                types.includes(t)
                  ? "border-gold-400 bg-gold-400/15 text-gold-300"
                  : "border-ink-700 text-slate-400 hover:bg-ink-800",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <Field label="Student / external ref" hint="e.g. student ID (optional)" error={fieldErrs.externalRef}>
        <Input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder="Optional" />
      </Field>

      <Field label="University" hint={editing && universityId ? "A university is already linked — search to change it." : "Pick or add a provisional one (optional)."}>
        <EntityPicker
          placeholder="Search university…"
          search={searchUniversity}
          onCreate={createUniversity}
          onPick={(i) => setUniversityId(i?.id ?? null)}
        />
      </Field>

      <Field label="Programme" hint="e.g. MBA, BBA (optional)" error={fieldErrs.programme}>
        <Input value={programme} onChange={(e) => setProgramme(e.target.value)} placeholder="Optional" />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Contact email" error={fieldErrs.contact}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Contact phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
        </Field>
      </div>

      {error && <ErrorNote message={error} />}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !displayName.trim()}>
          {busy ? "Saving…" : editing ? "Save changes" : "Create"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
