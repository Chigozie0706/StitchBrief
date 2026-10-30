import { chatJson, ModelOutputError, readMetaConfig, type MetaConfig } from "../meta/client";
import { analyzeParts, ANALYZE_SYSTEM, clarifyParts, CLARIFY_SYSTEM, generateParts, GENERATE_SYSTEM } from "../meta/prompts";
import { mockAnalyze, mockBrief, mockClarify } from "../meta/mock";
import { ANALYSIS_SCHEMA, BRIEF_SCHEMA, CLARIFY_SCHEMA } from "../meta/schemas";
import { dedupeQuestions } from "../clarify";
import { LIMITS } from "../config";
import type { AnalysisResult, BriefData, Provider as Mode, Question } from "../types";
import { parseAnalysisResult, parseBrief, parseQuestions, type AnalyzeRequest, type ClarifyRequest, type GenerateRequest, type Result } from "../validation";

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
  clarify: async (r) => dedupeQuestions(r.questions, mockClarify(r), LIMITS.MAX_NEW_QUESTIONS),
  generate: async (r) => mockBrief(r),
};

/** Calls the model; if the output fails validation, retries once, then surfaces a ModelOutputError. */
async function validated<T>(call: () => Promise<unknown>, parse: (raw: unknown) => Result<T>): Promise<T> {
  let lastError = "invalid output";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = parse(await call());
      if (parsed.ok) return parsed.value;
      lastError = parsed.error;
    } catch (e) {
      if (!(e instanceof ModelOutputError)) throw e;
      lastError = e.message;
    }
  }
  throw new ModelOutputError(`The model did not return usable data (${lastError}).`);
}

export function createLiveProvider(config: MetaConfig, fetchImpl?: typeof fetch): BriefProvider {
  const call = (system: string, user: Parameters<typeof chatJson>[0]["user"], schemaName: string, schema: Record<string, unknown>) =>
    chatJson({ config, system, user, schemaName, schema, fetchImpl });
  return {
    mode: "live",
    model: config.model,
    analyze: (r) => validated(() => call(ANALYZE_SYSTEM, analyzeParts(r), "garment_analysis", ANALYSIS_SCHEMA), parseAnalysisResult),
    clarify: async (r) => {
      const qs = await validated(() => call(CLARIFY_SYSTEM, clarifyParts(r), "followup_questions", CLARIFY_SCHEMA), (raw) => parseQuestions((raw as { questions?: unknown })?.questions, false, 8));
      return dedupeQuestions(r.questions, qs, LIMITS.MAX_NEW_QUESTIONS);
    },
    generate: (r) => validated(() => call(GENERATE_SYSTEM, generateParts(r), "sewing_brief", BRIEF_SCHEMA), parseBrief),
  };
}

/** Live provider when MODEL_API_KEY is set, otherwise the labelled mock provider. */
export function getProvider(env: Record<string, string | undefined> = process.env): BriefProvider {
  const config = readMetaConfig(env);
  return config ? createLiveProvider(config) : mockProvider;
}
