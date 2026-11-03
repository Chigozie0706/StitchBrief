/**
 * Live smoke test against the REAL Meta Model API. Run locally with your key:
 *   pnpm smoke:live ./path/to/outfit.jpg ["client description"]
 * Reads MODEL_API_KEY (and optional META_MODEL / META_REASONING_EFFORT) from .env.local.
 * Prints a short report. Never prints the key or the image.
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { listModels, MetaApiError, ModelOutputError, readMetaConfig, type MetaConfig } from "../src/lib/meta/client";
import { createLiveProvider } from "../src/lib/server/provider";
import { assembleBrief, buildLedger, confirmedTopics } from "../src/lib/assemble";
import { dedupeQuestions } from "../src/lib/clarify";
import { autoRequested, garmentLabelFor } from "../src/lib/upload-flow";
import { parseImageDataUrl } from "../src/lib/validation";
import type { Question } from "../src/lib/types";

export type SmokeStep = { name: string; ok: boolean; ms: number; detail: string };
export type SmokeReport = { ok: boolean; model: string; steps: SmokeStep[] };

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function safeMessage(e: unknown): string {
  if (e instanceof MetaApiError) return `HTTP ${e.status} ${e.code}: ${e.message}`;
  if (e instanceof ModelOutputError) return `invalid model output: ${e.message}`;
  return e instanceof Error ? e.message : "unexpected error";
}

export async function runSmoke(config: MetaConfig, imagePath: string, description: string, fetchImpl?: typeof fetch): Promise<SmokeReport> {
  const steps: SmokeStep[] = [];
  const run = async <T>(name: string, fn: () => Promise<{ value: T; detail: string }>): Promise<T | null> => {
    const t0 = Date.now();
    try {
      const { value, detail } = await fn();
      steps.push({ name, ok: true, ms: Date.now() - t0, detail });
      return value;
    } catch (e) {
      steps.push({ name, ok: false, ms: Date.now() - t0, detail: safeMessage(e) });
      return null;
    }
  };

  const mime = MIME[extname(imagePath).toLowerCase()];
  if (!mime) throw new Error("Image must be .jpg, .jpeg, .png or .webp");
  const image = `data:${mime};base64,${readFileSync(imagePath).toString("base64")}`;
  const check = parseImageDataUrl(image);
  if (!check.ok) throw new Error(check.error);

  const provider = createLiveProvider(config, fetchImpl);
  const ctx = { description, garment: "", occasion: "" };

  await run("GET /models", async () => {
    const ids = await listModels(config, fetchImpl);
    if (!ids.includes(config.model)) throw new Error(`model "${config.model}" is not listed for this key (available: ${ids.join(", ") || "none"})`);
    return { value: ids, detail: `${ids.length} models visible; "${config.model}" is available` };
  });

  const analysis = await run("analyze (image + structured output)", async () => {
    const a = await provider.analyze({ ...ctx, image });
    const by = (st: string) => a.observations.filter((o) => o.status === st).length;
    return { value: a, detail: `${a.garments.length} garment(s) [${a.garments.map((g) => `${g.name}:${g.type}`).join(", ")}]; ${a.observations.length} details (observed ${by("observed")}, client_confirmed ${by("client_confirmed")}, ai_suggested ${by("ai_suggested")}, uncertain ${by("uncertain")}, unknown ${by("unknown")}, needs_measurement ${by("needs_measurement")}); ${a.questions.length} questions; ${a.differences.length} differences` };
  });
  if (!analysis) return { ok: false, model: config.model, steps };

  // The smoke test picks the first visible garment when several are shown (the app asks the designer).
  const requested = autoRequested("", analysis.garments) ?? [analysis.garments[0].name];
  const answered: Question[] = analysis.questions.map((q, i) => (i === 0 ? { ...q, answer: q.options[0] ?? "Test answer", round: 1 as const } : { ...q, round: 1 as const }));
  const base = { ...ctx, garment: garmentLabelFor(analysis.garments.filter((g) => requested.includes(g.name))), observations: analysis.observations, differences: analysis.differences, requested };
  const followups = await run("clarify (follow-up round)", async () => {
    const f = dedupeQuestions(answered, await provider.clarify({ ...base, questions: answered }), 3, confirmedTopics(buildLedger({ ...base, questions: answered })));
    return { value: f, detail: `${f.length} new follow-up question(s) after removing repeats and confirmed topics` };
  });

  await run("generate-brief (validated + assembled)", async () => {
    const questions = [...answered, ...(followups ?? [])];
    const b = await provider.generate({ ...base, image, questions });
    const { sections, warnings } = assembleBrief(b, buildLedger({ ...base, questions }), base);
    return { value: b, detail: `title "${b.title}"; ${b.pieces.length} piece(s); ${sections.length} sections; ${warnings.length} warning(s)` };
  });

  return { ok: steps.every((s) => s.ok), model: config.model, steps };
}

async function main() {
  const [imagePath, ...rest] = process.argv.slice(2);
  const config = readMetaConfig();
  if (!imagePath) { console.error("Usage: pnpm smoke:live ./outfit.jpg [\"client description\"]"); process.exit(2); }
  if (!config) { console.error("MODEL_API_KEY is not set (or MOCK_MODE=true). Put it in .env.local and retry."); process.exit(2); }
  const report = await runSmoke(config, imagePath, rest.join(" ") || "Client wants an outfit like this one, with a slightly higher neckline.");
  console.log(`\nLive smoke test — model ${report.model}\n`);
  for (const s of report.steps) console.log(`${s.ok ? "PASS" : "FAIL"}  ${s.name}  (${s.ms} ms)\n      ${s.detail}`);
  console.log(`\n${report.ok ? "All steps passed against the real API." : "Some steps failed — see above."}`);
  process.exit(report.ok ? 0 : 1);
}

if (require.main === module) void main();
