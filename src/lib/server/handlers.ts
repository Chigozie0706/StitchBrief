import { LIMITS } from "../config";
import { listModels, MetaApiError, ModelOutputError, readMetaConfig } from "../meta/client";
import { parseAnalyzeRequest, parseClarifyRequest, parseGenerateRequest, type Result } from "../validation";
import { getProvider, type BriefProvider } from "./provider";
import { rateLimit } from "./rate-limit";

type Handler = (req: Request, provider?: BriefProvider) => Promise<Response>;

function err(status: number, code: string, message: string, headers?: Record<string, string>): Response {
  return Response.json({ ok: false, error: { code, message } }, { status, headers });
}

function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

async function readJson(req: Request): Promise<Result<unknown> | Response> {
  const len = Number(req.headers.get("content-length"));
  if (Number.isFinite(len) && len > LIMITS.MAX_BODY_BYTES) return err(413, "payload_too_large", "The request is too large. Use a smaller image.");
  const raw = await req.text();
  if (raw.length > LIMITS.MAX_BODY_BYTES) return err(413, "payload_too_large", "The request is too large. Use a smaller image.");
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return err(400, "invalid_json", "The request body was not valid JSON.");
  }
}

function mapFailure(e: unknown): Response {
  if (e instanceof MetaApiError) {
    const status = e.status === 401 || e.status === 402 || e.status === 403 ? 502 : e.status === 429 ? 429 : e.status >= 500 ? 502 : e.status === 504 ? 504 : e.status;
    // Log status/code only — never keys, prompts or image data.
    console.error(`[meta] upstream error status=${e.status} code=${e.code}`);
    return err(status, e.code, e.message);
  }
  if (e instanceof ModelOutputError) {
    console.error("[meta] invalid model output");
    return err(502, "invalid_model_output", e.message);
  }
  console.error("[server] unexpected error");
  return err(500, "internal_error", "Something went wrong. Please try again.");
}

function make<Req, Res>(
  parse: (body: unknown) => Result<Req>,
  run: (p: BriefProvider, r: Req) => Promise<Res>,
  wrap: (res: Res) => unknown,
): Handler {
  return async (req, provider = getProvider()) => {
    const rl = rateLimit(clientKey(req));
    if (!rl.allowed) return err(429, "rate_limited", "Too many requests. Please wait a moment.", { "Retry-After": String(rl.retryAfter) });
    const body = await readJson(req);
    if (body instanceof Response) return body;
    if (!body.ok) return err(400, "invalid_request", body.error);
    const parsed = parse(body.value);
    if (!parsed.ok) return err(400, "invalid_request", parsed.error);
    try {
      const out = await run(provider, parsed.value);
      return Response.json({ ok: true, provider: provider.mode, model: provider.model, data: wrap(out) });
    } catch (e) {
      return mapFailure(e);
    }
  };
}

export const handleAnalyze = make(parseAnalyzeRequest, (p, r) => p.analyze(r), (d) => d);
export const handleClarify = make(parseClarifyRequest, (p, r) => p.clarify(r), (questions) => ({ questions }));
export const handleGenerate = make(parseGenerateRequest, (p, r) => p.generate(r), (brief) => ({ brief }));

/** GET /api/health[?verify=1] — reports configuration without exposing the key. */
export async function handleHealth(req: Request, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const config = readMetaConfig(env);
  const base = { mode: config ? "live" : "mock", keyConfigured: Boolean(env.MODEL_API_KEY?.trim()), model: config?.model ?? null };
  if (!config || new URL(req.url).searchParams.get("verify") !== "1") return Response.json({ ok: true, ...base });
  const rl = rateLimit(`health:${clientKey(req)}`, 5);
  if (!rl.allowed) return err(429, "rate_limited", "Too many requests.");
  try {
    const models = await listModels(config, fetchImpl);
    return Response.json({ ok: true, ...base, modelsVisibleToKey: models, configuredModelAvailable: models.includes(config.model) });
  } catch (e) {
    return mapFailure(e);
  }
}
