"use client";
import { useState } from "react";
import Link from "next/link";
import { apiSend, logout, useApi } from "@/lib/api";
import { bannerMessage } from "@/lib/field-errors";
import { type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Badge, Card, dcInput, Page, T } from "@/components/dc";

/**
 * Self-service Profile & security (business plane), recreated to the Business OS
 * v5 design. A user manages only what is theirs: their password. Identity facts
 * (email, linked person) are read-only and roles are shown but not editable — role
 * changes are an admin action (no self-promotion, §10). A password change revokes
 * every session, so on success we sign out to re-authenticate cleanly.
 */
export default function ProfilePage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr("");
    try {
      await apiSend("auth/change-password", "POST", { currentPassword: current, newPassword: next });
      setDone(true);
      setTimeout(() => void logout(), 1600);
    } catch (e2) {
      setErr(bannerMessage(e2, "Could not change password") ?? "Could not change password");
      setBusy(false);
    }
  }

  const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: T.muted };
  const ro: React.CSSProperties = { ...dcInput, marginTop: 4, background: T.canvas, color: T.ink2 };

  return (
    <AppShell>
      <div style={{ maxWidth: 620 }}>
        <Page title="Profile & security" sub="manage your own login — roles are assigned by an administrator">
          {me && (
            <>
              <Card style={{ padding: 16, marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>Your details</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label style={label}>Sign-in email<div style={ro}>{me.account?.email ?? "—"}</div></label>
                  <label style={label}>Linked person<div style={ro}>{me.party ? <Link href={`/people/${me.party.id}`} style={{ color: T.goldDeep, textDecoration: "none" }}>{me.party.displayName}</Link> : "Not linked"}</div></label>
                  <label style={{ ...label, gridColumn: "1 / -1" }}>Roles
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                      {me.roleNames.length ? me.roleNames.map((r) => <Badge key={r} tone="blue">{r}</Badge>) : <span style={{ color: T.muted2 }}>No roles</span>}
                    </div>
                  </label>
                </div>
                <p style={{ marginTop: 12, borderTop: `1px solid ${T.eyebrow}`, paddingTop: 10, fontSize: 11, color: T.muted2 }}>
                  Your name & contact live on your <Link href={me.party ? `/people/${me.party.id}` : "/people"} style={{ color: T.goldDeep, textDecoration: "none" }}>person record</Link>. Only an administrator can change your roles.
                </p>
              </Card>

              <Card style={{ padding: 16, marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>Change password</div>
                {done ? (
                  <p style={{ borderRadius: 8, background: T.greenBg, color: T.green, padding: "12px 12px", fontSize: 13 }}>
                    Password changed. You&apos;ve been signed out of all devices — redirecting you to sign in…
                  </p>
                ) : (
                  <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} style={dcInput} />
                    <input type="password" autoComplete="new-password" placeholder="New password (min 8)" value={next} onChange={(e) => setNext(e.target.value)} style={{ ...dcInput, borderColor: tooShort ? T.red : T.border }} />
                    <input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ ...dcInput, borderColor: mismatch ? T.red : T.border }} />
                    {mismatch && <span style={{ fontSize: 11, color: T.red }}>Passwords do not match.</span>}
                    {err && <span style={{ fontSize: 11.5, color: T.red, fontWeight: 600 }}>{err}</span>}
                    <div style={{ textAlign: "right", marginTop: 2 }}>
                      <button type="submit" disabled={!canSubmit} style={{ background: T.ink, color: "#F0D08C", fontWeight: 700, fontSize: 12.5, padding: "8px 16px", borderRadius: 8, cursor: canSubmit ? "pointer" : "not-allowed", border: "none", opacity: canSubmit ? 1 : 0.55 }}>
                        {busy ? "Updating…" : "Update password"}
                      </button>
                    </div>
                    <p style={{ fontSize: 11, color: T.muted2 }}>Changing your password signs you out everywhere.</p>
                  </form>
                )}
              </Card>

              <Card style={{ padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 700 }}>Two-factor authentication</span>
                  <span style={{ display: "block", fontSize: 11.5, color: T.muted2, marginTop: 2 }}>Required for money & vault roles. Recommended for everyone.</span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 999, background: T.eyebrow, color: T.muted }}>Managed by admin</span>
              </Card>
            </>
          )}
        </Page>
      </div>
    </AppShell>
  );
}
