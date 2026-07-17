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
import { Badge, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";

const TYPE_LABEL: Record<string, string> = { doc: "doc", prompt_pack: "prompt pack", blog: "blog" };

function Attachment({ f }: { f: FileMeta }) {
  const [imgFailed, setImgFailed] = useState(false);
  if (f.isLink) {
    return (
      <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className="text-sm text-blue-700 hover:underline">
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
        className="max-h-80 max-w-full rounded-lg border border-ink-700"
      />
    );
  }
  return (
    <a href={fileSrc(f.id)} target="_blank" rel="noreferrer" className="text-sm text-blue-700 hover:underline">
      📎 {f.filename ?? "download"}
    </a>
  );
}

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useApi<ArticleDetail>(`knowledge/articles/${id}`);

  return (
    <AppShell>
      <Link href="/knowledge" className="mb-3 inline-block text-xs text-slate-400 hover:underline">
        ← Knowledge base
      </Link>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && (
        <article className="space-y-4">
          <header className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">{data.article.title}</h1>
              <Badge tone="blue">{TYPE_LABEL[data.article.type] ?? data.article.type}</Badge>
            </div>
            <p className="text-xs text-slate-400">updated {formatDate(data.article.updatedAt)}</p>
            {data.article.universityRefId && (
              <Link href={`/universities/${data.article.universityRefId}`} className="text-xs text-blue-700 hover:underline">
                <RefName id={data.article.universityRefId} /> hub →
              </Link>
            )}
          </header>

          {data.article.body && (
            <Card>
              <div className="whitespace-pre-wrap text-sm text-slate-200">{data.article.body}</div>
            </Card>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-200">Attachments</h2>
            {data.attachments.length === 0 ? (
              <EmptyState title="No attachments" />
            ) : (
              <ul className="space-y-3">
                {data.attachments.map((f) => (
                  <li key={f.id}>
                    <Attachment f={f} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </article>
      )}
    </AppShell>
  );
}
