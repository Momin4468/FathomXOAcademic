export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Business OS</h1>
      <p className="mt-1 text-sm text-gray-500">FathomXO — Academic · Phase 1 foundation</p>

      <div className="mt-8 rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-medium text-gray-700">Foundation in place</h2>
        <ul className="mt-3 space-y-1 text-sm text-gray-600">
          <li>• Tenancy + identity + access (org_id everywhere)</li>
          <li>• Money chain (legs) with database-enforced visibility (RLS)</li>
          <li>• Append-only ledger; profit derived, never stored</li>
        </ul>
        <p className="mt-4 text-xs text-gray-400">
          Capture-first screens (&ldquo;my open loops&rdquo;, add-a-job, job detail) arrive in
          module 4. The visual design language is a later round.
        </p>
      </div>
    </main>
  );
}
