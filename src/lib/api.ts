import type { AnalysisResult, ApiErr, ApiOk, BriefData, Difference, Provider, Question } from "./types";

export class ApiError extends Error {
  constructor(message: string, public code: string, public retryable: boolean) {
    super(message);
  }
}

export type ApiResult<T> = { data: T; provider: Provider; model: string | null };

async function post<T>(path: string, body: unknown, timeoutMs = 120_000): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    let json: ApiOk<T> | ApiErr | null = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    if (!json) throw new ApiError(`The server returned an unexpected response (${res.status}).`, "bad_response", res.status >= 500);
    if (!json.ok) throw new ApiError(json.error.message, json.error.code, res.status >= 500 || res.status === 429);
    return { data: json.data, provider: json.provider, model: json.model };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as { name?: string })?.name === "AbortError") throw new ApiError("The request took too long. Please try again.", "timeout", true);
    throw new ApiError("Could not reach the server. Check your connection and try again.", "network", true);
  } finally {
    clearTimeout(timer);
  }
}

type Ctx = { description: string; garment: string; occasion: string };

export const analyzeImage = (b: Ctx & { image: string }) => post<AnalysisResult>("/api/analyze", b);
export const fetchFollowups = (b: Ctx & { observations: unknown[]; questions: Question[]; differences?: Difference[] }) => post<{ questions: Question[] }>("/api/clarify", b);
export const generateBrief = (b: Ctx & { image?: string; observations: unknown[]; questions: Question[]; differences?: Difference[] }) => post<{ brief: BriefData }>("/api/generate-brief", b);
