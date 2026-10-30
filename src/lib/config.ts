// Shared (client + server) limits. No secrets here.
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const LIMITS = {
  /** Decoded image bytes accepted by the server (client compresses well below this). */
  MAX_IMAGE_BYTES: 8_000_000,
  /** File size accepted from the user before client-side compression. */
  MAX_UPLOAD_BYTES: 10_000_000,
  /** Whole JSON request body. Meta allows 50 MB inline; we stay far below it. */
  MAX_BODY_BYTES: 12_000_000,
  MAX_DESCRIPTION: 2000,
  MAX_SHORT_TEXT: 200,
  MAX_ANSWER: 600,
  MAX_OBSERVATIONS: 30,
  MAX_QUESTIONS: 20,
  MAX_NEW_QUESTIONS: 3,
} as const;

/** Output cap per call (counts reasoning tokens too per the Chat Completions reference). */
export const MAX_COMPLETION_TOKENS = 8000;
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const DEFAULT_MODEL = "muse-spark-1.3";
export const META_BASE_URL = "https://api.meta.ai/v1";
