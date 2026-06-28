"use client";
import { PfShell } from "@/components/PfShell";
import { PfEntryManager } from "@/components/PfEntryManager";

export default function PfExpensesPage() {
  return (
    <PfShell>
      <PfEntryManager kind="expense" />
    </PfShell>
  );
}
