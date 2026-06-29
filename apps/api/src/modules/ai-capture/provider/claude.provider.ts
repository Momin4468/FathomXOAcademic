import { Injectable } from "@nestjs/common";
import type { AiCaptureProvider, CaptureInput, ExtractResult } from "./ai-capture.port.js";
import { EXTRACTION_SYSTEM_PROMPT, parseProposals } from "./llm-extract.js";

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Claude (Sonnet) adapter — text + image. Uses the Anthropic Messages REST API
 * via fetch (no SDK dependency). Requires ANTHROPIC_API_KEY — fails closed if
 * absent. Voice/audio isn't supported natively (use gemini for voice). Returns
 * PROPOSALS only; never writes.
 */
@Injectable()
export class ClaudeCaptureProvider implements AiCaptureProvider {
  readonly name = "claude";

  async extract(input: CaptureInput): Promise<ExtractResult> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("AI_CAPTURE_PROVIDER=claude but ANTHROPIC_API_KEY is not set");
    const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

    if (input.media && !IMAGE_MIMES.has(input.media.mime)) {
      return {
        proposals: [],
        model,
        tokens: 0,
        note: "Claude reads text and images; for voice set AI_CAPTURE_PROVIDER=gemini.",
      };
    }

    const content: Array<Record<string, unknown>> = [];
    if (input.media && IMAGE_MIMES.has(input.media.mime)) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: input.media.mime, data: input.media.buffer.toString("base64") },
      });
    }
    content.push({ type: "text", text: input.text ? `INPUT:\n${input.text}` : "Extract proposals from the attached image." });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) throw new Error(`Claude request failed (${res.status})`);
    const json = (await res.json()) as {
      content?: Array<{ text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const out = json.content?.map((c) => c.text ?? "").join("") ?? "";
    const tokens = (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0);
    return { proposals: parseProposals(out), model, tokens };
  }
}
