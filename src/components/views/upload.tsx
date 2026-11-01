"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Sparkles, UploadCloud, X } from "lucide-react";
import { analyzeImage, ApiError, verifyImageHash } from "@/lib/api";
import { formatBytes, prepareImage, validateImageFile } from "@/lib/image";
import { analysisKey, GARMENT_OPTIONS, garmentForApi } from "@/lib/upload-flow";
import type { AnalysisResult, BriefForm, Provider } from "@/lib/types";

export type AnalyzedPayload = { form: BriefForm; analysis: AnalysisResult; provider: Provider; model: string | null };
type Phase = "none" | "preparing" | "uploading" | "analyzing";
type Meta = { name: string; width: number; height: number; bytes: number; resized: boolean; advisory: string | null };

export function Upload({ initial, analyzedKey, hasBrief, onAnalyzed, onContinue }: {
  initial: BriefForm; analyzedKey: string; hasBrief: boolean;
  onAnalyzed: (p: AnalyzedPayload) => void; onContinue: (patch: { garment: string }) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const [image, setImage] = useState(initial.image);
  const [thumb, setThumb] = useState(initial.thumb);
  const [imageHash, setImageHash] = useState(initial.imageHash);
  const [imageSource, setImageSource] = useState(initial.imageSource);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [description, setDescription] = useState(initial.description);
  const [garment, setGarment] = useState(initial.garment);
  const [occasion, setOccasion] = useState(initial.occasion);
  const [phase, setPhase] = useState<Phase>("none");
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abortRef.current?.abort(); }; }, []);

  const busy = phase !== "none";
  const previewOnly = imageSource === "preview";
  const unchanged = analyzedKey !== "" && analysisKey({ imageHash, description, occasion }) === analyzedKey;
  const imageReplaced = analyzedKey !== "" && imageHash !== initial.imageHash;
  const canSubmit = Boolean(image) && description.trim().length > 0 && !busy && (unchanged || !previewOnly);

  const choose = async (files: FileList | File[] | null | undefined) => {
    if (busy || !files || files.length === 0) return;
    const file = files[0];
    setNotice(files.length > 1 ? "Only the first image was used." : "");
    const problem = validateImageFile(file);
    if (problem) { setError(problem); setRetryable(false); return; } // the current image stays selected
    setError(""); setPhase("preparing");
    try {
      const p = await prepareImage(file);
      if (!mounted.current) return;
      setImage(p.image); setThumb(p.thumb); setImageHash(p.hash); setImageSource("original");
      setMeta({ name: file.name, width: p.width, height: p.height, bytes: p.bytes, resized: p.resized, advisory: p.advisory });
    } catch (e) {
      if (mounted.current) { setError(e instanceof Error ? e.message : "That image could not be processed."); setRetryable(false); }
    } finally {
      if (mounted.current) setPhase("none");
    }
  };

  const remove = () => {
    if (busy) return;
    setImage(""); setThumb(""); setImageHash(""); setImageSource("original"); setMeta(null); setError(""); setNotice("");
  };

  const submit = async () => {
    if (inFlight.current || !canSubmit) return;
    if (unchanged) { onContinue({ garment }); return; }
    if (hasBrief && !window.confirm("Analyzing again will discard the current brief, which was generated from the previous image or request. Continue?")) return;
    inFlight.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(""); setPhase("uploading");
    const form: BriefForm = { image, thumb, imageHash, imageSource: "original", description: description.trim(), garment, occasion: occasion.trim() };
    try {
      const r = await analyzeImage({ image, description: form.description, garment: garmentForApi(garment), occasion: form.occasion }, { signal: controller.signal, onUploaded: () => { if (mounted.current) setPhase("analyzing"); } });
      verifyImageHash(imageHash, r.data.imageHash);
      if (!mounted.current) return;
      onAnalyzed({ form, analysis: r.data, provider: r.provider, model: r.model });
    } catch (e) {
      if (!mounted.current || controller.signal.aborted) return;
      const err = e instanceof ApiError ? e : null;
      setError(err?.message ?? "Something went wrong while analyzing the image.");
      setRetryable(err?.retryable ?? true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setPhase("none");
    }
  };

  const statusText = error ? "Analysis failed. Your image and description are kept — nothing needs to be re-entered."
    : phase === "preparing" ? "Reading image…"
    : phase === "uploading" ? "Uploading image…"
    : phase === "analyzing" ? "Upload complete. Analyzing visible details…"
    : !image ? "Choose a reference image to begin."
    : unchanged ? "This image and request were already analyzed."
    : "Image ready. Add the client’s request, then analyze.";
  const statusPhase = error ? "failed" : phase !== "none" ? phase : image ? "ready" : "idle";

  return <div className="page narrow">
    <p className="eyebrow">New brief · 1 of 3</p><h2>Let’s turn your inspiration<br />into a clear brief.</h2><p className="lede">Start with what you can see and what your client has told you. We’ll flag everything else for confirmation.</p>
    <div className="upload-grid">
      <section className="panel">
        <div className="panel-label"><span>01</span><div><strong>Reference image</strong><small>JPEG, PNG or WebP · up to 10 MB</small></div></div>
        {image ? <>
          <div className="preview"><img src={image} alt="Selected garment reference" /><button className="remove" disabled={busy} onClick={remove}><X /> Remove</button><span>Primary reference</span></div>
          <p className="file-meta" data-testid="file-meta">{meta ? `${meta.name} · ${meta.width}×${meta.height} · ${formatBytes(meta.bytes)}${meta.resized ? " · resized for upload" : ""}` : "Stored preview"}</p>
          {previewOnly && <p className="advisory">Only a small preview of this image is stored with the draft. To analyze again, add the original image with “Replace image”.</p>}
          {meta?.advisory && <p className="advisory" data-testid="quality-advisory">{meta.advisory}</p>}
        </> : <button className="dropzone" disabled={busy} onClick={() => fileRef.current?.click()} onDrop={(e) => { e.preventDefault(); choose(e.dataTransfer.files); }} onDragOver={(e) => e.preventDefault()}><UploadCloud /><strong>Drop an image here</strong><span>or choose from your device · up to 10 MB</span></button>}
        <input ref={fileRef} data-testid="file-input" type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { choose(e.target.files); e.target.value = ""; }} />
        <button className="secondary full" onClick={() => fileRef.current?.click()} disabled={busy}><UploadCloud /> {image ? "Replace image" : "Choose image"}</button>
        {notice && <p className="hint">{notice}</p>}
        {imageReplaced && <p className="hint">Replacing the image re-runs the analysis. Your earlier answers are kept but marked for review; image observations are not carried over.</p>}
      </section>
      <section className="panel form-panel">
        <label><span>Describe what your client wants <b>Required</b></span><textarea disabled={busy} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} rows={6} placeholder="What do you like about it? What should change? Colour, fit and comfort, the occasion, and anything you’re unsure about…" /><small className="hint">Share what you know. Anything missing becomes a question next, so you don’t need every detail.</small></label>
        <div className="field-row"><label><span>Garment type</span><select disabled={busy} value={garment} onChange={(e) => setGarment(e.target.value)}>{GARMENT_OPTIONS.map((o) => <option key={o}>{o}</option>)}</select></label><label><span>Occasion</span><input disabled={busy} value={occasion} maxLength={200} onChange={(e) => setOccasion(e.target.value)} /></label></div>
        <small className="hint">We check the garment type against the photo and flag any difference. For outfits with several pieces, each piece is analyzed separately.</small>
        <div className="notice"><Sparkles /><p><strong>What AI can and can’t do</strong><br />Suggestions use visible details only. Fabric composition, body measurements, hidden construction, and patterns always require confirmation.</p></div>
        <p className={`upload-status ${statusPhase}`} role="status" aria-live="polite" data-testid="upload-status" data-phase={statusPhase}>{statusText}</p>
        {error && <div className="error" role="alert" data-testid="upload-error">{error}</div>}
        <button disabled={!canSubmit} className="primary full" onClick={submit}>{busy ? (phase === "preparing" ? "Reading image…" : phase === "uploading" ? "Uploading…" : "Analyzing visible details…") : unchanged ? "Continue to clarification" : error && retryable ? "Try again" : "Analyze inspiration"} {!busy && <ArrowRight />}</button>
      </section>
    </div>
  </div>;
}
