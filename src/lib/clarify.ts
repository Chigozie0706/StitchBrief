import type { Difference, Observation, Question } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Drops proposed questions that repeat an existing id or (normalised) wording. */
export function dedupeQuestions(existing: Question[], proposed: Question[], max = 3): Question[] {
  const ids = new Set(existing.map((q) => q.id));
  const texts = new Set(existing.map((q) => norm(q.question)));
  const out: Question[] = [];
  for (const q of proposed) {
    const t = norm(q.question);
    if (ids.has(q.id) || texts.has(t)) continue;
    ids.add(q.id);
    texts.add(t);
    out.push(q);
    if (out.length >= max) break;
  }
  return out;
}

export const isAnswered = (q: Question) => Boolean(q.skipped || (q.answer && q.answer.trim()));
export const unresolvedRequired = (qs: Question[]) => qs.filter((q) => q.required && !isAnswered(q));

/** Fingerprint of everything a brief is generated from. If it changes, the brief is stale. */
export function answersKey(questions: Question[], observations: Observation[], differences: Difference[] = []): string {
  return JSON.stringify([
    questions.map((q) => [q.id, (q.answer ?? "").trim(), Boolean(q.skipped)]),
    observations.map((o) => [o.key, o.value, o.source, o.confidence]),
    differences.map((d) => [d.topic, d.client_wants]),
  ]);
}
