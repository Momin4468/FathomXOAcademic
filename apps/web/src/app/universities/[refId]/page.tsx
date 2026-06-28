"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/api";
import { fileSrc } from "@/lib/upload";
import type { UniversityHub } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Badge, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";

/** University hub (§7): programmes, referencing styles, articles, cover sheets. */
export default function UniversityHubPage() {
  const { refId } = useParams<{ refId: string }>();
  const { data, error, isLoading } = useApi<UniversityHub>(`knowledge/university/${refId}`);

  return (
    <AppShell>
      <Link href="/knowledge" className="mb-3 inline-block text-xs text-gray-500 hover:underline">
        ← Knowledge base
      </Link>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && (
        <div className="space-y-5">
          <h1 className="text-lg font-semibold tracking-tight">{data.university.canonical}</h1>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">Programmes</h2>
            {data.programmes.length === 0 ? (
              <EmptyState title="No programmes linked" />
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.programmes.map((p) => (
                  <Badge key={p.id} tone="blue">{p.canonical}</Badge>
                ))}
              </div>
            )}
          </section>

          {data.referencingStyles.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">Referencing style</h2>
              <div className="flex flex-wrap gap-2">
                {data.referencingStyles.map((r) => (
                  <Badge key={r.id} tone="amber">{r.canonical}</Badge>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">Articles</h2>
            {data.articles.length === 0 ? (
              <EmptyState title="No linked articles" />
            ) : (
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
                {data.articles.map((a) => (
                  <li key={a.id}>
                    <Link href={`/knowledge/${a.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50">
                      <span className="text-sm font-medium">{a.title}</span>
                      <Badge tone="blue">{a.type}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">Cover sheets</h2>
            {data.coverSheets.length === 0 ? (
              <EmptyState title="No cover sheets" />
            ) : (
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
                {data.coverSheets.map((cs) => (
                  <li key={cs.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="font-medium">{cs.name}</span>
                    {cs.fileObjectId && (
                      <a href={fileSrc(cs.fileObjectId)} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                        Download
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
