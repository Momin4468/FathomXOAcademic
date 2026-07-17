"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/api";
import { fileSrc } from "@/lib/upload";
import type { UniversityHub } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Badge, Card, EmptyBox, Loading, Note, Page, T } from "@/components/dc";

/** University hub (§7): programmes, referencing styles, articles, cover sheets. */
export default function UniversityHubPage() {
  const { refId } = useParams<{ refId: string }>();
  const { data, error, isLoading } = useApi<UniversityHub>(`knowledge/university/${refId}`);

  return (
    <AppShell>
      <Link href="/knowledge" style={{ fontSize: 12, fontWeight: 600, color: T.goldDeep, textDecoration: "none", display: "inline-block", marginBottom: 8 }}>
        ← Knowledge base
      </Link>
      {isLoading && <Loading />}
      {error && <Note>{error.message}</Note>}
      {data && (
        <Page title={data.university.canonical} sub="programmes · referencing · articles · cover sheets">
          <div style={{ display: "grid", gap: 16 }}>
            <section style={{ display: "grid", gap: 8 }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Programmes</h2>
              {data.programmes.length === 0 ? (
                <EmptyBox title="No programmes linked" />
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {data.programmes.map((p) => (
                    <Badge key={p.id} tone="blue">{p.canonical}</Badge>
                  ))}
                </div>
              )}
            </section>

            {data.referencingStyles.length > 0 && (
              <section style={{ display: "grid", gap: 8 }}>
                <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Referencing style</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {data.referencingStyles.map((r) => (
                    <Badge key={r.id} tone="amber">{r.canonical}</Badge>
                  ))}
                </div>
              </section>
            )}

            <section style={{ display: "grid", gap: 8 }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Articles</h2>
              {data.articles.length === 0 ? (
                <EmptyBox title="No linked articles" />
              ) : (
                <Card>
                  {data.articles.map((a, i) => (
                    <Link
                      key={a.id}
                      href={`/knowledge/${a.id}`}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 14px", borderTop: i ? `1px solid ${T.hair}` : undefined, textDecoration: "none", color: T.ink }}
                    >
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.title}</span>
                      <Badge tone="blue">{a.type}</Badge>
                    </Link>
                  ))}
                </Card>
              )}
            </section>

            <section style={{ display: "grid", gap: 8 }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Cover sheets</h2>
              {data.coverSheets.length === 0 ? (
                <EmptyBox title="No cover sheets" />
              ) : (
                <Card>
                  {data.coverSheets.map((cs, i) => (
                    <div key={cs.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 14px", borderTop: i ? `1px solid ${T.hair}` : undefined, fontSize: 12.5 }}>
                      <span style={{ fontWeight: 600 }}>{cs.name}</span>
                      {cs.fileObjectId && (
                        <a href={fileSrc(cs.fileObjectId)} target="_blank" rel="noreferrer" style={{ color: T.blue, textDecoration: "none", fontWeight: 600 }}>
                          Download
                        </a>
                      )}
                    </div>
                  ))}
                </Card>
              )}
            </section>
          </div>
        </Page>
      )}
    </AppShell>
  );
}
