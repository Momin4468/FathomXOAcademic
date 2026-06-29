import type { AiCaptureKind, AiProposalTarget } from "@business-os/shared";

/** DI token for the swappable capture provider. */
export const AI_CAPTURE_PROVIDER = Symbol("AI_CAPTURE_PROVIDER");

export interface CaptureInput {
  kind: AiCaptureKind;
  text?: string;
  /** Raw bytes for image/voice (the provider does the vision/transcription step). */
  media?: { buffer: Buffer; mime: string };
}

/** One extracted candidate — a DRAFT only. `fields` map to the target's create DTO. */
export interface ProposedRecord {
  targetType: AiProposalTarget;
  fields: Record<string, unknown>;
  confidence: number; // 0..1
  label: string; // short human summary for the review card
}

export interface ExtractResult {
  proposals: ProposedRecord[];
  model: string;
  tokens: number;
  /** Optional user-facing note (e.g. dev provider declining media). */
  note?: string;
}

/**
 * Swappable extraction provider (mirrors EmailService/StorageService). It ONLY
 * proposes — it never writes a domain record. Adapters: dev (free, default),
 * gemini, claude — selected by AI_CAPTURE_PROVIDER.
 */
export interface AiCaptureProvider {
  readonly name: string;
  extract(input: CaptureInput): Promise<ExtractResult>;
}
