import type { AnalysisResult, ApiErr, ApiOk, BriefData, Difference, Provider, Question } from "./types";

export class ApiError extends Error {
  constructor(message: string, public code: string, public retryable: boolean) {
    super(message);
  }
}

export type ApiResult<T> = { data: T; provider: Provider; model: string | null };
export type RequestOptions = {
  signal?: AbortSignal;
  /** Fires when the request body has been fully sent (real upload progress via XHR in browsers). */
  onUploaded?: () => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function interpret<T>(status: number, text: string): ApiResult<T> {
  let json: ApiOk<T> | ApiErr | null = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (!json) throw new ApiError(`The server returned an unexpected response (${status}).`, "bad_response", status >= 500);
  if (!json.ok) throw new ApiError(json.error.message, json.error.code, status >= 500 || status === 429);
  return { data: json.data, provider: json.provider, model: json.model };
}

const aborted = () => new ApiError("Cancelled.", "aborted", false);
const unreachable = () => new ApiError("Could not reach the server. Check your connection and try again.", "network", true);
const timedOut = () => new ApiError("The request took too long. Please try again.", "timeout", true);

function viaXhr(path: string, payload: string, o: RequestOptions, timeoutMs: number): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    if (o.signal?.aborted) return reject(aborted());
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = timeoutMs;
    xhr.upload.onload = () => o.onUploaded?.();
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(unreachable());
    xhr.ontimeout = () => reject(timedOut());
    xhr.onabort = () => reject(aborted());
    o.signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(payload);
  });
}

async function viaFetch(path: string, payload: string, o: RequestOptions, timeoutMs: number): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  o.signal?.addEventListener("abort", () => controller.abort("cancel"));
  try {
    const pending = (o.fetchImpl ?? fetch)(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, signal: controller.signal });
    o.onUploaded?.(); // fetch cannot observe upload completion; callers in browsers get the XHR path instead
    const res = await pending;
    return { status: res.status, text: await res.text() };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as { name?: string })?.name === "AbortError") throw o.signal?.aborted ? aborted() : timedOut();
    throw unreachable();
  } finally {
    clearTimeout(timer);
  }
}

async function post<T>(path: string, body: unknown, o: RequestOptions = {}): Promise<ApiResult<T>> {
  const timeoutMs = o.timeoutMs ?? 120_000;
  const payload = JSON.stringify(body);
  const useXhr = !o.fetchImpl && o.onUploaded !== undefined && typeof XMLHttpRequest !== "undefined";
  const { status, text } = await (useXhr ? viaXhr(path, payload, o, timeoutMs) : viaFetch(path, payload, o, timeoutMs));
  return interpret<T>(status, text);
}

/** Throws if the server analysed different bytes than the client sent. Skips when either side has no hash. */
export function verifyImageHash(expected: string, actual: string | null | undefined): void {
  if (expected && actual && expected !== actual)
    throw new ApiError("The result came back for a different image than the one you selected. Please try again.", "image_mismatch", true);
}

type Ctx = { description: string; garment: string; occasion: string };

export const analyzeImage = (b: Ctx & { image: string }, o?: RequestOptions) => post<AnalysisResult & { imageHash: string }>("/api/analyze", b, o);
export const fetchFollowups = (b: Ctx & { observations: unknown[]; questions: Question[]; differences?: Difference[] }, o?: RequestOptions) => post<{ questions: Question[] }>("/api/clarify", b, o);
export const generateBrief = (b: Ctx & { image?: string; observations: unknown[]; questions: Question[]; differences?: Difference[] }, o?: RequestOptions) => post<{ brief: BriefData; imageHash: string | null }>("/api/generate-brief", b, o);
