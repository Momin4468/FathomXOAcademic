import { Injectable } from "@nestjs/common";
import type { AiCaptureProvider, CaptureInput, ExtractResult } from "./ai-capture.port.js";
import { EXTRACTION_SYSTEM_PROMPT, parseProposals } from "./llm-extract.js";

/**
 * Gemini adapter (free-tier capable; text + image + voice). Uses the REST
 * generateContent endpoint via fetch (no SDK dependency). Requires GEMINI_API_KEY
 * — fails closed if absent. Returns PROPOSALS only; never writes.
 */
@Injectable()
export class GeminiCaptureProvider implements AiCaptureProvider {
  readonly name = "gemini";

  async extract(input: CaptureInput): Promise<ExtractResult> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("AI_CAPTURE_PROVIDER=gemini but GEMINI_API_KEY is not set");
    const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";

    const parts: Array<Record<string, unknown>> = [{ text: EXTRACTION_SYSTEM_PROMPT }];
    if (input.text) parts.push({ text: `\n\nINPUT:\n${input.text}` });
    if (input.media) {
      parts.push({ inline_data: { mime_type: input.media.mime, data: input.media.buffer.toString("base64") } });
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini request failed (${res.status})`);
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { totalTokenCount?: number };
    };
    const out = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return {
      proposals: parseProposals(out),
      model,
      tokens: json.usageMetadata?.totalTokenCount ?? 0,
    };
  }
}
