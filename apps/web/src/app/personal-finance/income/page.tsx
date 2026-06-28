"use client";
import { PfShell } from "@/components/PfShell";
import { PfEntryManager } from "@/components/PfEntryManager";

export default function PfIncomePage() {
  return (
    <PfShell>
      <PfEntryManager kind="income" />
    </PfShell>
  );
}
