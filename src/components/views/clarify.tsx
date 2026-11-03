"use client";

import { useState } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { ApiError, fetchFollowups, generateBrief, verifyImageHash } from "@/lib/api";
import { answersKey, isAnswered, reviewPending } from "@/lib/clarify";
import { canConfirm, canUndo, confirmDecision, markUncertain, STATUS_LABEL, unmarkUncertain } from "@/lib/decisions";
import { garmentLabelFor, GARMENT_OPTIONS, groupByPiece, lowDetail, NOT_SURE, type GarmentChoice, type ReviewNote } from "@/lib/upload-flow";
import type { BriefForm, DecisionStatus, DetectedGarment, Difference, Observation, Provider, Question, Section } from "@/lib/types";

const pillClass: Record<DecisionStatus, string> = { observed: "observed", client_confirmed: "confirmed", ai_suggested: "suggested", uncertain: "uncertain", unknown: "unknown", needs_measurement: "measure" };

export function MockNotice({ provider }: { provider: Provider | null }) {
  if (provider !== "mock") return null;
  return <div className="notice mock-notice"><Sparkles /><p><strong>Mock mode</strong><br />No <code>MODEL_API_KEY</code> is configured, so the image was <b>not</b> analyzed. Details below come only from your description and fixed sample questions.</p></div>;
}

export type Generated = { title: string; sections: Section[]; warnings: string[]; provider: Provider; key: string };

export function Clarify({ data, summary, missing, differences, garments, requested, choice, reviewNotes, hasEdits, observations, setObservations, questions, setQuestions, provider, followupsChecked, setFollowupsChecked, onGenerated, onChoose, onChooseOther, dismissNotes, back }: {
  data: BriefForm; summary: string; missing: string[]; differences: Difference[]; garments: DetectedGarment[];
  requested: string[] | null; choice: GarmentChoice | null; reviewNotes: ReviewNote[]; hasEdits: boolean;
  observations: Observation[]; setObservations: (o: Observation[]) => void;
  questions: Question[]; setQuestions: (q: Question[]) => void; provider: Provider | null;
  followupsChecked: boolean; setFollowupsChecked: (b: boolean) => void;
  onGenerated: (r: Generated) => void; onChoose: (pieces: string[]) => void; onChooseOther: (garment: string) => void;
  dismissNotes: () => void; back: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [other, setOther] = useState(false);
  const open = questions.filter((q) => !isAnswered(q)).length;
  const answered = questions.length - open;
  const toReview = reviewPending(questions).length;
  const update = (id: string, patch: Partial<Question>) => setQuestions(questions.map((q) => (q.id === id ? { ...q, needsReview: false, ...patch } : q)));
  const setObs = (i: number, next: Observation) => setObservations(observations.map((x, n) => (n === i ? next : x)));
  const groups = groupByPiece(observations);
  const originalImage = data.imageSource === "original";
  const isRef = (piece: string) => Boolean(requested && requested.length > 0 && !requested.some((r) => r.toLowerCase() === piece.toLowerCase()));

  const run = async () => {
    setBusy(true); setError(""); setNotice("");
    const ctx = { description: data.description, garment: data.garment, occasion: data.occasion, observations, questions, differences, requested: requested ?? [] };
    const key = answersKey(questions, observations, differences, requested);
    try {
      if (!followupsChecked) {
        const f = await fetchFollowups(ctx);
        setFollowupsChecked(true);
        if (f.data.questions.length > 0) {
          setQuestions([...questions, ...f.data.questions]);
          setNotice(`Based on your answers, ${f.data.questions.length === 1 ? "one more question needs" : `${f.data.questions.length} more questions need`} your attention. This is the last round of questions: answer or skip them, then generate the brief.`);
          return;
        }
      }
      if (hasEdits && !window.confirm("Generating again will replace the current brief, including any edits you made. You can restore the previous version from the editor. Continue?")) return;
      const g = await generateBrief({ ...ctx, image: originalImage ? data.image : undefined });
      if (originalImage) verifyImageHash(data.imageHash, g.data.imageHash);
      onGenerated({ title: g.data.brief.title, sections: g.data.sections, warnings: g.data.warnings, provider: g.provider, key });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="page clarify-page">
    <div className="workflow-head"><div><p className="eyebrow">New brief · 2 of 3</p><h2>Review, then clarify.</h2><p>Correct the visual read and answer only what you can. Anything you skip stays unresolved in the brief.</p></div><div className="progress"><span>{answered} of {questions.length} answered or skipped</span><div><i style={{ width: `${questions.length ? answered / questions.length * 100 : 0}%` }} /></div></div></div>
    <div className="status-strip" role="status" data-testid="analysis-status"><Check /><strong>{provider === "mock" ? "Mock analysis complete" : "Analysis complete"}</strong><span>{observations.length} details · {garments.length} garment{garments.length === 1 ? "" : "s"} visible</span><span>{open === 0 ? "No clarification needed" : `${open} question${open === 1 ? "" : "s"} open (all optional)`}</span></div>
    <MockNotice provider={provider} />
    {choice && <div className="notice mismatch-notice" role="alert" data-testid="garment-choice"><Sparkles /><div><p><strong>Which garment is this brief for?</strong><br />{choice.message}</p>
      <div className="notice-actions">{choice.options.map((o) => <button key={o.label} className="secondary" onClick={() => onChoose(o.pieces)}>{o.label}</button>)}<button className="secondary" onClick={() => setOther(!other)}>Another garment selection</button></div>
      {other && <div className="notice-actions"><select aria-label="Garment to create" defaultValue="" onChange={(e) => { if (e.target.value) { onChooseOther(e.target.value); setOther(false); } }}><option value="" disabled>Choose a garment…</option>{GARMENT_OPTIONS.filter((o) => o !== NOT_SURE).map((o) => <option key={o}>{o}</option>)}</select></div>}</div></div>}
    {requested && requested.length > 0 && garments.length > 1 && <p className="q-reason" data-testid="requested-note">Brief for: <strong>{requested.join(" + ")}</strong>. Other visible garments are reference context only.</p>}
    {reviewNotes.length > 0 && <div className="notice review-notice" role="status" data-testid="review-notes"><Sparkles /><div><p><strong>You replaced the reference image</strong><br />These earlier corrections described the previous image and were not carried over. Re-apply them if they still fit:</p><ul>{reviewNotes.map((n) => <li key={`${n.piece}-${n.label}`}>{n.piece} · {n.label}: “{n.value}”</li>)}</ul><div className="notice-actions"><button className="secondary" onClick={dismissNotes}>Dismiss</button></div></div></div>}
    {provider === "live" && lowDetail(observations) && <div className="notice" role="status" data-testid="low-detail"><Sparkles /><div><p><strong>Not much detail was visible</strong><br />Most details could not be read from this photo. A clearer, well-lit photo of the whole garment usually helps.</p><div className="notice-actions"><button className="secondary" onClick={back}>Replace image</button></div></div></div>}
    <div className="clarify-grid">
      <section className="reference-panel">
        {data.image && <img className="reference-image" src={data.image} alt="Garment reference" />}<div className="client-note"><span>Client note</span><p>“{data.description}”</p></div>
        {summary && <p className="analysis-summary">{summary}</p>}
        {differences.length > 0 && <div className="differences"><div className="section-head compact"><h3>Differs from the reference</h3></div>{differences.map((d) => <div className="difference" key={d.topic}><strong>{d.topic}</strong><span>Reference: {d.reference_shows}</span><span>Client wants: {d.client_wants}</span></div>)}</div>}
        {missing.length > 0 && <div className="missing"><div className="section-head compact"><h3>Still unknown</h3></div><ul>{missing.map((m) => <li key={m}>{m}</li>)}</ul></div>}
        <div className="observations"><div className="section-head compact"><h3>Design details</h3><span className="source-pill observed">From the model</span></div>
          {groups.map((group) => { const ref = isRef(group.piece); return <div key={group.piece} data-testid={ref ? "reference-group" : "piece-group"} className={ref ? "reference-only" : ""}>
            {(groups.length > 1 || ref) && <h4 className="piece-title">{group.piece}{ref && <small className="ref-only"> · reference only, not part of the brief</small>}</h4>}
            {group.items.map(({ o, i }) => <div className="observation" key={`${o.piece}-${o.key}`}><div>
              <span>{o.label} <em className={`source-pill ${pillClass[o.status]}`}>{STATUS_LABEL[o.status]}</em></span>
              {ref ? <p className="obs-static">{o.value}</p> : <input aria-label={`${group.piece} ${o.label}`} value={o.value} onChange={(e) => setObs(i, confirmDecision(o, e.target.value))} />}
              {(o.reason || o.note) && o.status !== "client_confirmed" && <small className="obs-note">{o.reason || o.note}</small>}
            </div>
              {!ref && <div className="observation-controls">
                {canConfirm(o) && <button className="uncertain" onClick={() => setObs(i, confirmDecision(o))}>Confirm</button>}
                {o.status !== "uncertain" && <button className="uncertain" onClick={() => setObs(i, markUncertain(o))}>Mark uncertain</button>}
                {canUndo(o) && <button className="uncertain active" onClick={() => setObs(i, unmarkUncertain(o))}>Undo uncertain</button>}
              </div>}
            </div>)}
          </div>; })}
        </div>
      </section>
      <section className="questions">
        <div className="question-intro"><Sparkles /><div><strong>Clarification assistant</strong><p>Optional. Answer what you can; skip the rest.</p></div></div>
        {notice && <div className="notice followup-notice"><Sparkles /><p>{notice}</p></div>}
        {questions.map((q, index) => {
          const isOther = q.type === "single_select" && (q.custom || Boolean(q.answer && !q.options.includes(q.answer)));
          return <article className="question" key={q.id} data-testid={`question-${q.id}`}><span className="question-number">{String(index + 1).padStart(2, "0")}</span><h3>{q.question}{q.priority === "high" && <small className="req"> · key decision</small>}{q.round === 2 && <small className="req"> · follow-up</small>}</h3><p className="q-reason">{q.reason}</p>
            {q.needsReview && <div className="review-flag" data-testid="review-flag"><span>From your earlier answers. Confirm it, change it, or skip. Until then the brief lists it as uncertain.</span><button className="secondary" onClick={() => update(q.id, {})}>Keep answer</button></div>}
            {q.type === "single_select" && <div className="chips">{q.options.map((option) => <button className={q.answer === option && !q.skipped ? "selected" : ""} onClick={() => update(q.id, { answer: option, skipped: false, custom: false })} key={option}>{q.answer === option && !q.skipped && <Check />}{option}</button>)}<button className={isOther && !q.skipped ? "selected" : ""} onClick={() => update(q.id, { custom: true, answer: "", skipped: false })}>Something else</button></div>}
            {(q.type === "text" || isOther) && !q.skipped && <input className="custom-answer" aria-label={q.question} value={q.answer ?? ""} maxLength={600} onChange={(e) => update(q.id, { answer: e.target.value, skipped: false })} placeholder="Type your answer…" />}
            {q.skipped ? <button className="skip" onClick={() => update(q.id, { skipped: false })}>Skipped — stays unresolved in the brief. Undo</button> : !q.answer && <button className="skip" onClick={() => update(q.id, { skipped: true, answer: "", custom: false })}>Skip — leave unresolved</button>}
          </article>;
        })}
        {error && <div className="error" role="alert">{error}</div>}
        {choice && <p className="q-reason">Choose which garment to create above to continue.</p>}
        {!choice && open > 0 && <p className="q-reason" data-testid="open-note">{open} question{open === 1 ? " is" : "s are"} still open. You can generate the brief now; {open === 1 ? "it" : "they"} will be listed as unresolved.</p>}
        {toReview > 0 && <p className="q-reason">{toReview} earlier answer{toReview > 1 ? "s were" : " was"} not re-confirmed and will be listed as uncertain.</p>}
        <button className="primary full" disabled={busy || Boolean(choice)} onClick={run}>{busy ? (followupsChecked ? "Generating brief…" : "Checking your answers…") : error ? "Try again" : "Generate sewing brief"} {!busy && <ArrowRight />}</button>
        <button className="text-button" onClick={back} disabled={busy}>Back to image and request</button>
      </section>
    </div>
  </div>;
}
