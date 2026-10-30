"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";

type Health = { mode: "live" | "mock"; keyConfigured: boolean; model: string | null };

export function Settings() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => { fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(null)); }, []);
  return <div className="page narrow"><p className="eyebrow">Workspace preferences</p><h2>Settings</h2><section className="panel settings-panel"><h3>Brief defaults</h3><label><span>Studio name</span><input defaultValue="Amara Mensah Studio" /></label><label><span>Default units</span><select defaultValue="Centimetres"><option>Centimetres</option><option>Inches</option></select></label>
    <div className="notice"><FileText /><p><strong>Model connection</strong><br />{health === null ? "Checking…" : health.mode === "live" ? `Live — Meta Model API, model ${health.model}.` : "Mock mode — no MODEL_API_KEY configured on the server."}</p></div>
    <div className="notice"><FileText /><p><strong>Prototype storage</strong><br />Drafts are stored only in this browser. No account or cloud sync is connected.</p></div>
    <button className="primary" onClick={() => { try { localStorage.setItem("stitchbrief-settings", "saved"); } catch { /* storage unavailable */ } }}>Save preferences</button></section></div>;
}
