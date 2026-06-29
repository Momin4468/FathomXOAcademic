import { AI_PROPOSAL_TARGETS } from "@business-os/shared";
import type { ProposedRecord } from "./ai-capture.port.js";

/**
 * The shared extraction contract sent to a real LLM (Gemini/Claude). The model
 * PROPOSES only — the human accepts later. Field shapes mirror the create DTOs.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You convert messy business notes (text, WhatsApp chats, an image, or a voice transcript) into PROPOSED draft records for an academic-work brokerage. You ONLY propose; a human reviews and confirms every item, so never assume — when unsure, lower the confidence or omit.

Rules:
- Output STRICT JSON only, no prose, shape: {"proposals":[{"targetType","fields","confidence","label"}]}.
- targetType is one of: client, job, payment, expense.
- NEVER invent amounts, names, or dates. Only extract what is present. Omit fields you can't find.
- confidence is 0..1 (your certainty this is a real, correct record).
- label is a short human summary (e.g. "Paid 5000 to writer", "Job — ICT701 essay").
- fields by targetType:
  - client:  { displayName, partyType:["client"], externalRef?, universityRaw?, programme? }
  - job:     { title, details?, courseCodeRaw? }
  - payment: { direction:"in"|"out", amount(number), paidAt:"YYYY-MM-DD"?, counterpartyName?, note? }
  - expense: { category:"subscription"|"salary"|"promo"|"loss"|"event"|"other", amount(number), incurredAt:"YYYY-MM-DD"?, costBearer:"momin", note? }
Return {"proposals":[]} if nothing is identifiable.`;

/** Parse + whitelist an LLM JSON reply into safe ProposedRecord[] (never throws). */
export function parseProposals(raw: string): ProposedRecord[] {
  let text = raw.trim();
  // Tolerate ```json fences.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();
  // Else slice to the outermost JSON object.
  if (!text.startsWith("{")) {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s >= 0 && e > s) text = text.slice(s, e + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const list = (parsed as { proposals?: unknown })?.proposals;
  if (!Array.isArray(list)) return [];
  const out: ProposedRecord[] = [];
  for (const item of list) {
    const p = item as Record<string, unknown>;
    const targetType = p.targetType as string;
    if (!(AI_PROPOSAL_TARGETS as readonly string[]).includes(targetType)) continue;
    const fields = p.fields && typeof p.fields === "object" ? (p.fields as Record<string, unknown>) : {};
    let confidence = Number(p.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.5;
    confidence = Math.max(0, Math.min(1, confidence));
    out.push({
      targetType: targetType as ProposedRecord["targetType"],
      fields,
      confidence,
      label: typeof p.label === "string" ? p.label.slice(0, 200) : targetType,
    });
  }
  return out;
}
