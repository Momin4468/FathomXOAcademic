"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/api";
import { fileSrc } from "@/lib/upload";
import { formatDate } from "@/lib/format";
import type { ArticleDetail, FileMeta } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { RefName } from "@/components/RefName";
import { Badge, Card, EmptyBox, Loading, Note, T } from "@/components/dc";

const TYPE_LABEL: Record<string, string> = { doc: "doc", prompt_pack: "prompt pack", blog: "blog" };

function Attachment({ f }: { f: FileMeta }) {
  const [imgFailed, setImgFailed] = useState(false);
  const link: React.CSSProperties = { fontSize: 12.5, color: T.blue, textDecoration: "none" };
  if (f.isLink) {
    return (
      <a href={f.url ?? "#"} target="_blank" rel="noreferrer" style={link}>
        🔗 {f.filename ?? f.url}
      </a>
    );
  }
  if (f.mime?.startsWith("image/") && !imgFailed) {
    return (
      <img
        src={fileSrc(f.id)}
        alt={f.filename ?? ""}
        onError={() => setImgFailed(true)}
        style={{ maxHeight: 320, maxWidth: "100%", borderRadius: 8, border: `1px solid ${T.border}` }}
      />
    );
  }
  return (
    <a href={fileSrc(f.id)} target="_blank" rel="noreferrer" style={link}>
      📎 {f.filename ?? "download"}
    </a>
  );
}

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useApi<ArticleDetail>(`knowledge/articles/${id}`);

  return (
    <AppShell>
      <div style={{ fontFamily: "Inter, sans-serif", color: T.ink, maxWidth: 900 }}>
        <Link href="/knowledge" style={{ fontSize: 12, fontWeight: 600, color: T.goldDeep, textDecoration: "none" }}>
          ← Knowledge base
        </Link>
        {isLoading && <Loading />}
        {error && <div style={{ marginTop: 12 }}><Note>{error.message}</Note></div>}
        {data && (
          <div style={{ marginTop: 12, display: "grid", gap: 20 }}>
            <Card style={{ padding: "28px 32px", borderRadius: 14 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: T.goldDeep }}>
                {TYPE_LABEL[data.article.type] ?? data.article.type}
              </span>
              <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 27, fontWeight: 600, margin: "8px 0 6px", lineHeight: 1.2 }}>
                {data.article.title}
              </h1>
              <div style={{ fontSize: 12, color: T.muted2, marginBottom: 18, display: "flex", alignItems: "center", gap: 8 }}>
                <Badge tone="blue">{TYPE_LABEL[data.article.type] ?? data.article.type}</Badge>
                updated {formatDate(data.article.updatedAt)}
              </div>
              {data.article.universityRefId && (
                <Link href={`/universities/${data.article.universityRefId}`} style={{ fontSize: 12, color: T.blue, textDecoration: "none" }}>
                  <RefName id={data.article.universityRefId} /> hub →
                </Link>
              )}
              {data.article.body && (
                <div style={{ fontSize: 14, lineHeight: 1.7, color: T.codeText, whiteSpace: "pre-wrap", marginTop: 16 }}>
                  {data.article.body}
                </div>
              )}
            </Card>

            <section style={{ display: "grid", gap: 10 }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Attachments</h2>
              {data.attachments.length === 0 ? (
                <EmptyBox title="No attachments" />
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
                  {data.attachments.map((f) => (
                    <li key={f.id}>
                      <Attachment f={f} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
