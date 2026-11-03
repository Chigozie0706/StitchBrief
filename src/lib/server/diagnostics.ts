import type { AttemptRecord } from "../meta/client";

/** Single-line, length-capped text. Used for every string that reaches a log. */
export const safeText = (s: unknown, max = 300): string => {
  const t = String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const defaultSink = (line: string, failed: boolean) => (failed ? console.error : console.info)(line);
let sink: (record: Record<string, unknown>, line: string, failed: boolean) => void = (_r, line, failed) => defaultSink(line, failed);

/** Test hook: receive the structured record instead of (or as well as) the console line. */
export function setDiagnosticsSink(fn: ((record: Record<string, unknown>, line: string, failed: boolean) => void) | null) {
  sink = fn ?? ((_r, line, failed) => defaultSink(line, failed));
}

/**
 * Logs one model attempt as a single JSON line. Only whitelisted fields are copied: operation, attempt number,
 * model id, outcome, finish_reason, token counts, duration, response id and a short validation message.
 * Never prompts, images, client descriptions, occasions, API keys or model output.
 */
export function logAttempt(r: AttemptRecord): void {
  try {
    const record: Record<string, unknown> = {
      event: "model_call", op: r.op, attempt: r.attempt, model: safeText(r.model, 80), outcome: r.outcome,
      finish_reason: r.finishReason, usage: r.usage, ms: r.ms,
      ...(r.responseId ? { response_id: safeText(r.responseId, 64) } : {}), ...(r.error ? { error: safeText(r.error) } : {}), ...(r.retryHint ? { retry_hint: true } : {}),
    };
    sink(record, `[meta] ${JSON.stringify(record)}`, r.outcome !== "ok");
  } catch {
    /* logging must never break a request */
  }
}
