import { DEFAULT_MODEL, MAX_COMPLETION_TOKENS, META_BASE_URL, REASONING_EFFORTS, type ReasoningEffort } from "../config";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export class MetaApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelOutputError";
  }
}

export type MetaConfig = { apiKey: string; model: string; baseUrl: string; reasoningEffort?: ReasoningEffort };

/** Reads server-only configuration. Returns null when no key is set (-> mock mode). */
export function readMetaConfig(env: Record<string, string | undefined> = process.env): MetaConfig | null {
  if (env.MOCK_MODE === "true") return null;
  const apiKey = env.MODEL_API_KEY?.trim();
  if (!apiKey) return null;
  const effort = env.META_REASONING_EFFORT?.trim().toLowerCase() as ReasoningEffort | undefined;
  return {
    apiKey,
    model: env.META_MODEL?.trim() || DEFAULT_MODEL,
    baseUrl: env.META_BASE_URL?.trim() || META_BASE_URL,
    ...(effort && REASONING_EFFORTS.includes(effort) ? { reasoningEffort: effort } : {}),
  };
}

type JsonSchema = Record<string, unknown>;
export type ChatJsonOptions = {
  config: MetaConfig;
  system: string;
  user: ContentPart[];
  schemaName: string;
  schema: JsonSchema;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

/** Maps an upstream failure to a message that is safe to show users. Never includes secrets. */
export function toMetaError(status: number, body: unknown): MetaApiError {
  const err = (body as { error?: { message?: string; code?: string | null; type?: string } } | null)?.error;
  const code = err?.code ?? err?.type ?? "upstream_error";
  switch (status) {
    case 400: {
      const detail = typeof err?.message === "string" ? err.message.slice(0, 200) : "";
      return new MetaApiError(400, code, `Meta rejected the request${detail ? `: ${detail}` : "."}`);
    }
    case 401:
      return new MetaApiError(401, "invalid_api_key", "The Meta Model API key was rejected. Check MODEL_API_KEY.");
    case 402:
      return new MetaApiError(402, "billing", "The Meta Model API account has a billing issue.");
    case 403:
      return new MetaApiError(403, "forbidden", "This API key does not have access to the requested model.");
    case 404:
      return new MetaApiError(404, code, "The configured model was not found for this account. Check META_MODEL.");
    case 413:
      return new MetaApiError(413, "payload_too_large", "The image is too large for the model API.");
    case 429:
      return new MetaApiError(429, "rate_limited", "The model API is rate limiting requests. Please retry shortly.", true);
    case 504:
      return new MetaApiError(504, "gateway_timeout", "The model API timed out.", false);
    default:
      return new MetaApiError(status >= 500 ? 502 : status, code, "The model API is temporarily unavailable.", status >= 500);
  }
}

function stripFences(s: string): string {
  const t = s.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return m ? m[1] : t;
}

/**
 * Calls POST {base}/chat/completions with a JSON-schema response_format and returns the parsed JSON.
 * Docs: https://dev.meta.ai/docs/structured-output and /docs/image-understanding
 */
export async function chatJson(opts: ChatJsonOptions): Promise<unknown> {
  const { config, system, user, schemaName, schema } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 2;
  const body = JSON.stringify({
    model: config.model,
    temperature: 0.2,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: { name: schemaName, schema } },
  });

  let lastError: MetaApiError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
    try {
      const res = await doFetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        let parsed: unknown = null;
        try { parsed = await res.json(); } catch { /* non-JSON error body */ }
        const err = toMetaError(res.status, parsed);
        if (err.retryable && attempt < maxRetries) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 500 * 2 ** attempt;
          lastError = err;
          await sleep(wait);
          continue;
        }
        throw err;
      }
      const json = (await res.json()) as { choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: string }[] };
      const choice = json.choices?.[0];
      if (choice?.finish_reason === "length") throw new ModelOutputError("The model response was cut off before it finished.");
      if (choice?.finish_reason === "content_filter") throw new ModelOutputError("The model's safety filter blocked this response.");
      const content = choice?.message?.content;
      if (typeof choice?.message?.refusal === "string" && choice.message.refusal.trim() && !content) throw new ModelOutputError("The model declined this request.");
      if (typeof content !== "string" || !content.trim()) throw new ModelOutputError("The model returned an empty response.");
      try {
        return JSON.parse(stripFences(content));
      } catch {
        throw new ModelOutputError("The model returned text that was not valid JSON.");
      }
    } catch (e) {
      if (e instanceof MetaApiError || e instanceof ModelOutputError) throw e;
      const aborted = (e as { name?: string })?.name === "AbortError";
      const err = aborted
        ? new MetaApiError(504, "timeout", "The model API took too long to respond.", true)
        : new MetaApiError(502, "network", "Could not reach the model API.", true);
      if (attempt < maxRetries) { lastError = err; await sleep(500 * 2 ** attempt); continue; }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new MetaApiError(502, "unknown", "The model API request failed.");
}

/** GET /v1/models — used by /api/health to confirm what this key can actually use. */
export async function listModels(config: MetaConfig, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchImpl(`${config.baseUrl}/models`, { headers: { Authorization: `Bearer ${config.apiKey}` }, cache: "no-store" });
  if (!res.ok) {
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { /* ignore */ }
    throw toMetaError(res.status, parsed);
  }
  const json = (await res.json()) as { data?: { id?: string }[] };
  return (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
}
