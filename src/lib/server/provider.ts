import { expectedPieceNames } from "../assemble";
import { chatJson, ModelOutputError, readMetaConfig, type AttemptRecord, type CallMeta, type MetaConfig } from "../meta/client";
import { logAttempt, safeText } from "./diagnostics";
import { analyzeParts, ANALYZE_SYSTEM, clarifyParts, CLARIFY_SYSTEM, generateParts, GENERATE_SYSTEM, retryFeedback } from "../meta/prompts";
import { mockAnalyze, mockBrief, mockClarify } from "../meta/mock";
import { ANALYSIS_SCHEMA, BRIEF_SCHEMA, CLARIFY_SCHEMA } from "../meta/schemas";
import type { AnalysisResult, BriefData, Provider as Mode, Question } from "../types";
import { parseAnalysisResult, parseBrief, parseQuestions, type AnalyzeRequest, type ClarifyRequest, type GenerateRequest, type Result } from "../validation";

/** Providers only PROPOSE. Round limits, topic de-duplication and brief assembly happen in the handlers. */
export interface BriefProvider {
  mode: Mode;
  model: string | null;
  analyze(r: AnalyzeRequest): Promise<AnalysisResult>;
  clarify(r: ClarifyRequest): Promise<Question[]>;
  generate(r: GenerateRequest): Promise<BriefData>;
}

export const mockProvider: BriefProvider = {
  mode: "mock",
  model: null,
  analyze: async (r) => mockAnalyze(r),
  clarify: async (r) => mockClarify(r),
  generate: async (r) => mockBrief(r),
};

/** One line summarising every attempt, so the reason for the FIRST failure is never hidden by the last one. */
function summarizeAttempts(attempts: AttemptRecord[]): string {
  const reasons = attempts.map((a) => (a.error ?? a.outcome).replace(/\.$/, ""));
  return new Set(reasons).size === 1 && attempts.length > 1 ? `both attempts: ${reasons[0]}` : attempts.map((a, i) => `attempt ${a.attempt}: ${reasons[i]}`).join("; ");
}

/**
 * Calls the model; if the output fails validation, retries once, then surfaces a ModelOutputError.
 * Every attempt is recorded (outcome, finish_reason, token usage, reason) and logged; none is overwritten by a later one.
 */
async function validated<T>(op: string, model: string, call: (onCall: (m: CallMeta) => void, feedback?: string) => Promise<unknown>, parse: (raw: unknown) => Result<T>): Promise<T> {
  const attempts: AttemptRecord[] = [];
  // After a validation failure the retry explains what was wrong. Validation stays strict: nothing is merged or dropped here.
  let feedback: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let meta: CallMeta = { finishReason: null, usage: {} };
    const started = Date.now();
    const record = (outcome: AttemptRecord["outcome"], error?: string) => {
      const r: AttemptRecord = { op, attempt, model, outcome, finishReason: meta.finishReason, usage: meta.usage, ms: Date.now() - started, ...(meta.responseId ? { responseId: meta.responseId } : {}), ...(error ? { error } : {}), ...(feedback ? { retryHint: true } : {}) };
      attempts.push(r);
      logAttempt(r);
    };
    try {
      const parsed = parse(await call((m) => { meta = m; }, feedback));
      if (parsed.ok) { record("ok"); return parsed.value; }
      record("invalid_output", parsed.error);
      feedback = retryFeedback(safeText(parsed.error));
    } catch (e) {
      if (!(e instanceof ModelOutputError)) throw e; // HTTP-level failures are handled (and logged) by the handlers
      record(e.kind, e.message);
      feedback = e.kind === "not_json" ? retryFeedback(safeText(e.message)) : undefined; // truncation etc. are not fixed by an explanation
    }
  }
  throw new ModelOutputError(`The model did not return usable data (${summarizeAttempts(attempts)}).`, "invalid_output", attempts);
}

export function createLiveProvider(config: MetaConfig, fetchImpl?: typeof fetch): BriefProvider {
  const call = (system: string, user: Parameters<typeof chatJson>[0]["user"], schemaName: string, schema: Record<string, unknown>) => (onCall: (m: CallMeta) => void, feedback?: string) =>
    chatJson({ config, system, user: feedback ? [...user, { type: "text", text: feedback }] : user, schemaName, schema, fetchImpl, onCall });
  return {
    mode: "live",
    model: config.model,
    analyze: (r) => validated("analyze", config.model, call(ANALYZE_SYSTEM, analyzeParts(r), "garment_analysis", ANALYSIS_SCHEMA), parseAnalysisResult),
    clarify: (r) => validated("clarify", config.model, call(CLARIFY_SYSTEM, clarifyParts(r), "followup_questions", CLARIFY_SCHEMA), (raw) => parseQuestions((raw as { questions?: unknown })?.questions, false, 8)),
    generate: (r) => validated("generate", config.model, call(GENERATE_SYSTEM, generateParts(r), "sewing_brief", BRIEF_SCHEMA), (raw) => parseBrief(raw, expectedPieceNames(r))),
  };
}

/** Live provider when MODEL_API_KEY is set, otherwise the labelled mock provider. */
export function getProvider(env: Record<string, string | undefined> = process.env): BriefProvider {
  const config = readMetaConfig(env);
  return config ? createLiveProvider(config) : mockProvider;
}
