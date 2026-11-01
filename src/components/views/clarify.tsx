"use client";

import { useState } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { ApiError, fetchFollowups, generateBrief, verifyImageHash } from "@/lib/api";
import { isUncertain, SOURCE_LABEL } from "@/lib/brief";
import { answersKey, isAnswered, reviewPending, unresolvedRequired } from "@/lib/clarify";
import { groupByPiece, lowDetail, outfitLabel, type ReviewNote } from "@/lib/upload-flow";
import type { BriefData, BriefForm, DetectedGarment, Difference, Observation, Provider, Question } from "@/lib/types";

const sourceClass: Record<Observation["source"], string> = { observed: "observed", client_confirmed: "confirmed", ai_suggestion: "suggested", unknown: "unknown" };

export function MockNotice({ provider }: { provider: Provider | null }) {
  if (provider !== "mock") return null;
  return <div className="notice mock-notice"><Sparkles /><p><strong>Mock mode</strong><br />No <code>MODEL_API_KEY</code> is configured, so the image was <b>not</b> analyzed. Details below come only from your description and fixed sample questions.</p></div>;
}

export function Clarify({ data, summary, missing, differences, garments, mismatch, reviewNotes, hasEdits, observations, setObservations, questions, setQuestions, provider, followupsChecked, setFollowupsChecked, onGenerated, onResolveMismatch, dismissNotes, back }: {
  data: BriefForm; summary: string; missing: string[]; differences: Difference[]; garments: DetectedGarment[];
  mismatch: string | null; reviewNotes: ReviewNote[]; hasEdits: boolean;
  observations: Observation[]; setObservations: (o: Observation[]) => void;
  questions: Question[]; setQuestions: (q: Question[]) => void; provider: Provider | null;
  followupsChecked: boolean; setFollowupsChecked: (b: boolean) => void;
  onGenerated: (r: { brief: BriefData; provider: Provider; key: string }) => void;
  onResolveMismatch: (action: "use-detected" | "keep") => void; dismissNotes: () => void; back: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const open = questions.filter((q) => !isAnswered(q)).length;
  const answered = questions.length - open;
  const missingRequired = unresolvedRequired(questions).length;
  const toReview = reviewPending(questions).length;
  const update = (id: string, patch: Partial<Question>) => setQuestions(questions.map((q) => (q.id === id ? { ...q, needsReview: false, ...patch } : q)));
  const updateObs = (i: number, patch: Partial<Observation>) => setObservations(observations.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const groups = groupByPiece(observations);
  const originalImage = data.imageSource === "original";

  const run = async () => {
    setBusy(true); setError(""); setNotice("");
    const ctx = { description: data.description, garment: data.garment, occasion: data.occasion, observations, questions, differences };
    const key = answersKey(questions, observations, differences);
    try {
      if (!followupsChecked) {
        const f = await fetchFollowups(ctx);
        setFollowupsChecked(true);
        if (f.data.questions.length > 0) {
          setQuestions([...questions, ...f.data.questions]);
          setNotice(`Based on your answers, ${f.data.questions.length === 1 ? "one more question needs" : `${f.data.questions.length} more questions need`} your attention. Answer or skip, then generate again.`);
          return;
        }
      }
      if (hasEdits && !window.confirm("Generating again will replace the current brief, including any edits you made. You can restore the previous version from the editor. Continue?")) return;
      const g = await generateBrief({ ...ctx, image: originalImage ? data.image : undefined });
      if (originalImage) verifyImageHash(data.imageHash, g.data.imageHash);
      onGenerated({ brief: g.data.brief, provider: g.provider, key });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="page clarify-page">
    <div className="workflow-head"><div><p className="eyebrow">New brief · 2 of 3</p><h2>Review, then clarify.</h2><p>Correct the visual read and answer only the questions that affect the brief.</p></div><div className="progress"><span>{answered} of {questions.length} answered</span><div><i style={{ width: `${questions.length ? answered / questions.length * 100 : 0}%` }} /></div></div></div>
    <div className="status-strip" role="status" data-testid="analysis-status"><Check /><strong>{provider === "mock" ? "Mock analysis complete" : "Analysis complete"}</strong><span>{observations.length} observations · {garments.length} garment{garments.length === 1 ? "" : "s"}</span><span>{open === 0 ? "No clarification needed" : `Clarification needed: ${open} question${open === 1 ? "" : "s"} open`}</span></div>
    <MockNotice provider={provider} />
    {mismatch && <div className="notice mismatch-notice" role="alert" data-testid="garment-mismatch"><Sparkles /><div><p><strong>Garment type check</strong><br />{mismatch} Which is right?</p><div className="notice-actions"><button className="secondary" onClick={() => onResolveMismatch("use-detected")}>Use {outfitLabel(garments)}</button><button className="secondary" onClick={() => onResolveMismatch("keep")}>Keep {data.garment}</button></div></div></div>}
    {reviewNotes.length > 0 && <div className="notice review-notice" role="status" data-testid="review-notes"><Sparkles /><div><p><strong>You replaced the reference image</strong><br />These earlier corrections described the previous image and were not carried over. Re-apply them if they still fit:</p><ul>{reviewNotes.map((n) => <li key={`${n.piece}-${n.label}`}>{n.piece} · {n.label}: “{n.value}”</li>)}</ul><div className="notice-actions"><button className="secondary" onClick={dismissNotes}>Dismiss</button></div></div></div>}
    {provider === "live" && lowDetail(observations) && <div className="notice" role="status" data-testid="low-detail"><Sparkles /><div><p><strong>Not much detail was visible</strong><br />Most details could not be read from this photo. A clearer, well-lit photo of the whole garment usually helps.</p><div className="notice-actions"><button className="secondary" onClick={back}>Replace image</button></div></div></div>}
    <div className="clarify-grid">
      <section className="reference-panel">
        {data.image && <img className="reference-image" src={data.image} alt="Garment reference" />}<div className="client-note"><span>Client note</span><p>“{data.description}”</p></div>
        {summary && <p className="analysis-summary">{summary}</p>}
        {differences.length > 0 && <div className="differences"><div className="section-head compact"><h3>Differs from the reference</h3></div>{differences.map((d) => <div className="difference" key={d.topic}><strong>{d.topic}</strong><span>Reference: {d.reference_shows}</span><span>Client wants: {d.client_wants}</span></div>)}</div>}
        {missing.length > 0 && <div className="missing"><div className="section-head compact"><h3>Still unknown</h3></div><ul>{missing.map((m) => <li key={m}>{m}</li>)}</ul></div>}
        <div className="observations"><div className="section-head compact"><h3>Visible observations</h3><span className="source-pill observed">From the model</span></div>
          {groups.map((group) => <div key={group.piece} data-testid="piece-group">
            {groups.length > 1 && <h4 className="piece-title">{group.piece}</h4>}
            {group.items.map(({ o, i }) => <div className="observation" key={`${o.piece}-${o.key}`}><div><span>{o.label} <em className={`source-pill ${sourceClass[o.source]}`}>{SOURCE_LABEL[o.source]}</em></span><input aria-label={`${group.piece} ${o.label}`} value={o.value} onChange={(e) => updateObs(i, { value: e.target.value, source: "client_confirmed", confidence: "high" })} />{o.note && <small className="obs-note">{o.note}</small>}</div><button className={isUncertain(o) ? "uncertain active" : "uncertain"} onClick={() => updateObs(i, { confidence: isUncertain(o) ? "medium" : "low", ...(o.source === "unknown" ? { source: "ai_suggestion" as const } : {}) })}>{isUncertain(o) ? "Marked uncertain" : "Mark uncertain"}</button></div>)}
          </div>)}
        </div>
      </section>
      <section className="questions">
        <div className="question-intro"><Sparkles /><div><strong>Clarification assistant</strong><p>These details can’t be confirmed from the image.</p></div></div>
        {notice && <div className="notice followup-notice"><Sparkles /><p>{notice}</p></div>}
        {questions.map((q, index) => {
          const isOther = q.type === "single_select" && (q.custom || Boolean(q.answer && !q.options.includes(q.answer)));
          return <article className="question" key={q.id} data-testid={`question-${q.id}`}><span className="question-number">{String(index + 1).padStart(2, "0")}</span><h3>{q.question}{q.required && <small className="req"> · required</small>}</h3><p className="q-reason">{q.reason}</p>
            {q.needsReview && <div className="review-flag" data-testid="review-flag"><span>From your earlier answers. Please confirm or change it.</span><button className="secondary" onClick={() => update(q.id, {})}>Keep answer</button></div>}
            {q.type === "single_select" && <div className="chips">{q.options.map((option) => <button className={q.answer === option && !q.skipped ? "selected" : ""} onClick={() => update(q.id, { answer: option, skipped: false, custom: false })} key={option}>{q.answer === option && !q.skipped && <Check />}{option}</button>)}<button className={isOther && !q.skipped ? "selected" : ""} onClick={() => update(q.id, { custom: true, answer: "", skipped: false })}>Something else</button></div>}
            {(q.type === "text" || isOther) && !q.skipped && <input className="custom-answer" aria-label={q.question} value={q.answer ?? ""} maxLength={600} onChange={(e) => update(q.id, { answer: e.target.value, skipped: false })} placeholder="Type your answer…" />}
            {q.skipped ? <button className="skip" onClick={() => update(q.id, { skipped: false })}>Skipped — marked not specified. Undo</button> : !q.answer && <button className="skip" onClick={() => update(q.id, { skipped: true, answer: "", custom: false })}>Skip — mark not specified</button>}
          </article>;
        })}
        {error && <div className="error" role="alert">{error}</div>}
        {toReview > 0 && <p className="q-reason">Confirm the {toReview} earlier answer{toReview > 1 ? "s" : ""} marked for review to continue.</p>}
        {missingRequired > 0 && toReview === 0 && <p className="q-reason">Answer or skip the {missingRequired} required question{missingRequired > 1 ? "s" : ""} to continue.</p>}
        <button className="primary full" disabled={busy || missingRequired > 0 || toReview > 0} onClick={run}>{busy ? (followupsChecked ? "Generating brief…" : "Checking your answers…") : error ? "Try again" : "Generate sewing brief"} {!busy && <ArrowRight />}</button>
        <button className="text-button" onClick={back} disabled={busy}>Back to image and request</button>
      </section>
    </div>
  </div>;
}
