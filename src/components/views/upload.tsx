"use client";

import { useRef, useState } from "react";
import { ArrowRight, Sparkles, UploadCloud, X } from "lucide-react";
import { analyzeImage, ApiError } from "@/lib/api";
import { prepareImage, validateImageFile } from "@/lib/image";
import type { AnalysisResult, BriefForm, Provider } from "@/lib/types";

export type AnalyzedPayload = { form: BriefForm; analysis: AnalysisResult; provider: Provider; model: string | null };

export function Upload({ initial, onAnalyzed }: { initial: BriefForm; onAnalyzed: (p: AnalyzedPayload) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState(initial.image);
  const [thumb, setThumb] = useState(initial.thumb);
  const [description, setDescription] = useState(initial.description);
  const [garment, setGarment] = useState(initial.garment);
  const [occasion, setOccasion] = useState(initial.occasion);
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);

  const choose = async (file?: File) => {
    if (!file) return;
    const problem = validateImageFile(file);
    if (problem) { setError(problem); setRetryable(false); return; }
    setError(""); setPreparing(true);
    try {
      const p = await prepareImage(file);
      setImage(p.image); setThumb(p.thumb);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That image could not be processed."); setRetryable(false);
    } finally {
      setPreparing(false);
    }
  };

  const submit = async () => {
    setLoading(true); setError("");
    const form: BriefForm = { image, thumb, description: description.trim(), garment, occasion: occasion.trim() };
    try {
      const r = await analyzeImage({ image, description: form.description, garment: form.garment, occasion: form.occasion });
      onAnalyzed({ form, analysis: r.data, provider: r.provider, model: r.model });
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError(err?.message ?? "Something went wrong while analyzing the image.");
      setRetryable(err?.retryable ?? true);
    } finally {
      setLoading(false);
    }
  };

  const busy = loading || preparing;
  return <div className="page narrow">
    <p className="eyebrow">New brief · 1 of 3</p><h2>Let’s turn your inspiration<br />into a clear brief.</h2><p className="lede">Start with what you can see and what your client has told you. We’ll flag everything else for confirmation.</p>
    <div className="upload-grid">
      <section className="panel">
        <div className="panel-label"><span>01</span><div><strong>Reference image</strong><small>JPEG, PNG or WebP · up to 10 MB</small></div></div>
        {image ? <div className="preview"><img src={image} alt="Selected garment reference" /><button className="remove" onClick={() => { setImage(""); setThumb(""); }}><X /> Remove</button><span>Primary reference</span></div> :
          <button className="dropzone" onClick={() => fileRef.current?.click()} onDrop={(e) => { e.preventDefault(); choose(e.dataTransfer.files[0]); }} onDragOver={(e) => e.preventDefault()}><UploadCloud /><strong>{preparing ? "Preparing image…" : "Drop an image here"}</strong><span>or choose from your device</span></button>}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="secondary full" onClick={() => fileRef.current?.click()} disabled={preparing}><UploadCloud /> {image ? "Replace image" : "Choose image"}</button>
      </section>
      <section className="panel form-panel">
        <label><span>Describe what your client wants <b>Required</b></span><textarea value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} rows={6} placeholder="Include desired changes, fit, mood, and any non-negotiables…" /></label>
        <div className="field-row"><label><span>Garment type</span><select value={garment} onChange={(e) => setGarment(e.target.value)}><option>Dress</option><option>Blouse</option><option>Trousers</option><option>Skirt</option><option>Two-piece set</option></select></label><label><span>Occasion</span><input value={occasion} maxLength={200} onChange={(e) => setOccasion(e.target.value)} /></label></div>
        <div className="notice"><Sparkles /><p><strong>What AI can and can’t do</strong><br />Suggestions use visible details only. Fabric composition, body measurements, hidden construction, and patterns always require confirmation.</p></div>
        {error && <div className="error" role="alert">{error}</div>}
        <button disabled={!image || !description.trim() || busy} className="primary full" onClick={submit}>{loading ? "Analyzing visible details…" : error && retryable ? "Try again" : "Analyze inspiration"} {!loading && <ArrowRight />}</button>
      </section>
    </div>
  </div>;
}
