import type { BriefStatus, Section } from "./types";

export function briefToText(title: string, sections: Section[]): string {
  return `${title}\n\n` + sections.map((s) => `${s.title}\n${s.body}`).join("\n\n");
}

export function briefToMarkdown(title: string, sections: Section[]): string {
  return `# ${title}\n\n` + sections.map((s) => `## ${s.title}\n\n${s.body}`).join("\n\n") + "\n";
}

/** "Ready" means ready for a tailor to REVIEW, not ready to cut or sew. */
export const statusLabel = (s: BriefStatus) => (s === "Ready" ? "Ready for tailor review" : s);

export type ReviewSummary = { confirmed: string[]; uncertain: string[]; unknown: string[]; measurements: string[] };
const bullets = (s: Section) => s.body.split("\n").filter((l) => l.startsWith("• ")).map((l) => l.slice(2));

/** What the tailor still has to look at, read from the brief as it currently stands (including the designer's edits). */
export function reviewSummary(sections: Section[]): ReviewSummary {
  const of = (...kinds: Section["kind"][]) => sections.filter((s) => kinds.includes(s.kind));
  const measurements = of("body_measurements", "garment_dimensions").flatMap((s) => bullets(s).map((b) => `${s.piece && sections.filter((x) => x.kind === s.kind).length > 1 ? `${s.piece}: ` : ""}${b}`));
  return { confirmed: of("confirmed").flatMap(bullets), uncertain: of("uncertain").flatMap(bullets), unknown: of("unknown").flatMap(bullets), measurements };
}

export function formatUpdated(iso: string | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 86_400_000).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  if (yesterday) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
