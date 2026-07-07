import { Injectable } from "@nestjs/common";
import type { AiCaptureProvider, CaptureInput, ExtractResult, ProposedRecord } from "./ai-capture.port.js";

const today = () => new Date().toISOString().slice(0, 10);

const MONEY_VERB = /\b(paid|pay|received|payment|sent|got|deposit|transfer|collected|spent|bought|buy|expense|bill|subscription|cost|purchase|salary|invoice)\b/i;

/** First currency-ish amount in a line; falls back to a bare number when the line
 *  clearly talks about money (a money verb is present). Null otherwise. */
function parseAmount(line: string): number | null {
  const cur = line.match(
    /(?:৳|tk\b|bdt|usd|\$|rs\.?)\s*([\d][\d,]*(?:\.\d{1,2})?)|([\d][\d,]*(?:\.\d{1,2})?)\s*(?:tk|taka|bdt|usd|dollars?)/i,
  );
  let raw = cur?.[1] ?? cur?.[2];
  if (!raw && MONEY_VERB.test(line)) {
    raw = line.match(/\b([\d][\d,]{1,}(?:\.\d{1,2})?)\b/)?.[1]; // a multi-digit number near money words
  }
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function titleCaseName(line: string): string | null {
  const m = line.match(/(?:client|student)\s*[:\-]?\s*([A-Z][\w'’.]+(?:\s+[A-Z][\w'’.]+){0,3})/);
  return m?.[1]?.trim() ?? null;
}

/**
 * The FREE, zero-cost default provider (DESIGN_SPEC §10). Deterministic heuristic
 * extraction over TEXT — no network, no API key, no spend. It proposes drafts the
 * human still has to accept. Image/voice need a real provider (gemini|claude);
 * the dev adapter declines media with a clear note. Best-effort one proposal per
 * line, by priority: payment > expense > job > client.
 */
@Injectable()
export class DevCaptureProvider implements AiCaptureProvider {
  readonly name = "dev";

  async extract(input: CaptureInput): Promise<ExtractResult> {
    if (input.kind === "image" || input.kind === "voice" || input.media) {
      return {
        proposals: [],
        model: "dev-heuristic",
        tokens: 0,
        note: "The free dev provider can't read images or voice. Set AI_CAPTURE_PROVIDER=gemini or claude (with an API key) to extract from media.",
      };
    }
    const text = (input.text ?? "").trim();
    if (!text) return { proposals: [], model: "dev-heuristic", tokens: 0 };

    const proposals: ProposedRecord[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const lower = line.toLowerCase();
      const amount = parseAmount(line);

      if (amount != null && /\b(paid|received|payment|sent|got|deposit|transfer)\b/.test(lower)) {
        const direction = /\b(received|got|deposit|collected)\b/.test(lower) ? "in" : "out";
        proposals.push({
          targetType: "payment",
          fields: { direction, amount, paidAt: today(), note: line },
          confidence: 0.5,
          label: `${direction === "in" ? "Received" : "Paid"} ৳${amount}`,
        });
        continue;
      }
      if (amount != null) {
        const isSub = /\bsubscription\b/.test(lower);
        proposals.push({
          targetType: "expense",
          fields: {
            category: isSub ? "subscription" : "other",
            amount,
            incurredAt: today(),
            // A safe, self-sufficient default (needs no bearer party). Who really
            // bears the cost (party|split) is a money attribution the human sets at Accept.
            costBearer: "writer",
            note: line,
          },
          confidence: 0.45,
          label: `Expense ৳${amount}`,
        });
        continue;
      }
      const course = line.match(/\b([A-Z]{2,4}\s?-?\d{3})\b/);
      if (course || /\b(assignment|essay|thesis|dissertation|report|coursework|exam)\b/i.test(lower)) {
        proposals.push({
          targetType: "job",
          fields: { title: line.slice(0, 280), details: line, courseCodeRaw: course?.[1] ?? null },
          confidence: 0.5,
          label: course ? `Job — ${course[1]}` : "Job",
        });
        continue;
      }
      const name = titleCaseName(line);
      if (name) {
        proposals.push({
          targetType: "client",
          fields: { displayName: name, partyType: ["client"] },
          confidence: 0.5,
          label: `Client — ${name}`,
        });
        continue;
      }
    }
    return { proposals, model: "dev-heuristic", tokens: 0 };
  }
}
