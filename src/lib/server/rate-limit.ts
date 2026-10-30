// Minimal in-memory sliding-window limiter. Per server instance only — NOT production-grade
// (state is lost on restart and not shared across serverless instances). Replace with a shared
// store (e.g. Redis/Upstash) before any public deployment.
const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit = 20, windowMs = 60_000, now = Date.now()): { allowed: boolean; retryAfter: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  return { allowed: true, retryAfter: 0 };
}

export const _resetRateLimit = () => hits.clear();
