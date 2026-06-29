import type { ImportEntity } from "@business-os/shared";
import type { Row } from "./parse.js";

/**
 * Per-entity templates: the exact expected headers (the format spec) + one filled
 * sample row (the demo). Headers are HUMAN-friendly (names/codes, not UUIDs) — the
 * importer resolves university/course/assignment via ReferenceService and parties
 * by name. These are served by GET /import/template/:entity and committed under
 * /import-helpers as the canonical spec.
 */
export const TEMPLATES: Record<ImportEntity, { headers: string[]; sample: Row }> = {
  clients: {
    headers: ["displayName", "partyType", "externalRef", "universityName", "programme", "contactEmail", "contactPhone", "referredByName"],
    sample: {
      displayName: "John Smith",
      partyType: "client",
      externalRef: "S1234567",
      universityName: "University of Melbourne",
      programme: "MIT",
      contactEmail: "john@example.com",
      contactPhone: "+8801700000000",
      referredByName: "",
    },
  },
  jobs: {
    headers: ["title", "clientName", "courseCode", "assignmentType", "doerName", "details", "notes"],
    sample: {
      title: "ICT701 Assignment 3",
      clientName: "John Smith",
      courseCode: "ICT 701",
      assignmentType: "essay",
      doerName: "",
      details: "2500 words, Harvard referencing",
      notes: "",
    },
  },
  payments: {
    headers: ["direction", "counterpartyName", "amount", "paidAt", "medium", "trxId", "note"],
    sample: {
      direction: "in",
      counterpartyName: "John Smith",
      amount: "12000",
      paidAt: "2026-02-15",
      medium: "bkash",
      trxId: "TX123456",
      note: "ICT701 A3 payment",
    },
  },
  settlement_opening: {
    headers: ["fromPartyName", "toPartyName", "amount", "asOfDate", "note"],
    sample: {
      fromPartyName: "Emon",
      toPartyName: "Momin",
      amount: "50000",
      asOfDate: "2026-01-01",
      note: "2025 opening settlement position",
    },
  },
};

const csvCell = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The downloadable template CSV (header row + one filled sample). */
export function templateCsv(entity: ImportEntity): string {
  const { headers, sample } = TEMPLATES[entity];
  const head = headers.map(csvCell).join(",");
  const row = headers.map((h) => csvCell(sample[h] ?? "")).join(",");
  return `${head}\r\n${row}\r\n`;
}
