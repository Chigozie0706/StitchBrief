import { covers, topicKey } from "./decisions";
import type { Difference, Observation, Question } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Drops proposed questions that repeat an existing id, wording or TOPIC (answered, skipped or unanswered),
 * or that ask about a topic the client has already confirmed.
 */
export function dedupeQuestions(existing: Question[], proposed: Question[], max = 3, confirmed: Set<string> = new Set()): Question[] {
  const ids = new Set(existing.map((q) => q.id));
  const texts = new Set(existing.map((q) => norm(q.question)));
  const topics = new Set([...existing.map((q) => topicKey(q.piece ?? "", q.topic || q.id)), ...confirmed]);
  const out: Question[] = [];
  for (const q of proposed) {
    if (ids.has(q.id) || texts.has(norm(q.question)) || covers(topics, q.piece ?? "", q.topic || q.id)) continue;
    ids.add(q.id); texts.add(norm(q.question)); topics.add(topicKey(q.piece ?? "", q.topic || q.id));
    out.push(q);
    if (out.length >= max) break;
  }
  return out;
}

/** A carried-over answer does not count as answered until the designer confirms or skips it. */
export const isAnswered = (q: Question) => !q.needsReview && Boolean(q.skipped || (q.answer && q.answer.trim()));
export const reviewPending = (qs: Question[]) => qs.filter((q) => q.needsReview);
/** The single follow-up round has been used: no further model questions are allowed. */
export const followupUsed = (qs: Question[]) => qs.some((q) => q.round === 2);

/** Fingerprint of everything a brief is generated from. If it changes, the brief is stale. */
export function answersKey(questions: Question[], observations: Observation[], differences: Difference[] = [], requested: string[] | null = []): string {
  return JSON.stringify([
    questions.map((q) => [q.id, (q.answer ?? "").trim(), Boolean(q.skipped), Boolean(q.needsReview)]),
    observations.map((o) => [o.piece, o.key, o.value, o.status]),
    differences.map((d) => [d.topic, d.client_wants]),
    requested,
  ]);
}
