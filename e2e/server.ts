// Test server: serves the bundled app and the REAL API handlers. Only Meta's model is stubbed (fake fetch).
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAnalyze, handleClarify, handleGenerate } from "../src/lib/server/handlers";
import { createLiveProvider } from "../src/lib/server/provider";
import { _resetRateLimit } from "../src/lib/server/rate-limit";
import { completion, liveAnalysisJson, liveBriefJson } from "../tests/helpers";

const dist = join(dirname(fileURLToPath(import.meta.url)), "dist");
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

export type Scenario = "dress" | "twopiece" | "weak";
const fresh = () => ({
  scenario: "dress" as Scenario, delayMs: 0, failRemaining: 0, currentFail: false, corruptHash: false,
  analyzeCount: 0, analyzeLog: [] as Record<string, unknown>[], generateLog: [] as Record<string, unknown>[], clarifyCount: 0,
});
export const state = fresh();

const piece = (p: string, key: string, label: string, value: string, source = "observed", confidence = "high") => ({ piece: p, key, label, value, source, confidence, note: "" });
function analysisFor(scenario: Scenario, n: number) {
  const a = structuredClone(liveAnalysisJson) as Record<string, any>;
  if (scenario === "dress") {
    for (const o of a.observations) if (o.key === "color" || o.key === "neckline") o.value = `${o.value.split(" (")[0]} (analysis #${n})`;
  } else if (scenario === "twopiece") {
    a.garments = [{ name: "Top", type: "top" }, { name: "Trousers", type: "trousers" }];
    a.observations = [piece("Top", "neckline", "Neckline", `Square (analysis #${n})`), piece("Top", "sleeves", "Sleeves", "Short"), piece("Trousers", "silhouette", "Silhouette", "Wide leg"), piece("Trousers", "length_category", "Length", "Ankle")];
    a.differences = [];
  } else {
    a.observations = a.observations.map((o: any) => ({ ...o, source: "unknown", confidence: "low", value: "Cannot tell from this photo" }));
  }
  return a;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** Stand-in for https://api.meta.ai/v1/chat/completions */
const metaStub: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  const name = body.response_format.json_schema.name as string;
  if (name === "garment_analysis") {
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
    const image = body.messages[1].content.find((p: any) => p.type === "image_url")?.image_url.url as string | undefined;
    state.analyzeLog[state.analyzeLog.length - 1].modelImageSha = image ? sha(image) : null;
    return json(200, completion(state.currentFail ? "this is not json" : analysisFor(state.scenario, state.analyzeCount)));
  }
  if (name === "followup_questions") return json(200, completion({ questions: [] }));
  if (name === "sewing_brief") return json(200, completion(liveBriefJson));
  return json(400, { error: { message: "unexpected schema" } });
};
const provider = createLiveProvider({ apiKey: "LLM_1_e2e", model: "muse-spark-1.3", baseUrl: "https://stub.invalid/v1" }, metaStub);

export async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const send = (status: number, type: string, body: string | Buffer) => { res.writeHead(status, { "content-type": type }); res.end(body); };
    try {
      if (path === "/") return send(200, "text/html", readFileSync(join(dist, "index.html")));
      if (path === "/app.js") return send(200, "text/javascript", readFileSync(join(dist, "app.js")));
      if (path === "/app.css") return send(200, "text/css", readFileSync(join(dist, "app.css")));
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks);
      if (path === "/__state") return send(200, "application/json", JSON.stringify(state));
      if (path === "/__reset") { Object.assign(state, fresh()); _resetRateLimit(); return send(200, "application/json", "{}"); }
      if (path === "/__control") { Object.assign(state, JSON.parse(raw.toString())); return send(200, "application/json", "{}"); }

      const handler = ({ "/api/analyze": handleAnalyze, "/api/clarify": handleClarify, "/api/generate-brief": handleGenerate } as const)[path as "/api/analyze"];
      if (!handler) return send(404, "text/plain", "not found");
      const parsed = JSON.parse(raw.toString() || "{}");
      if (path === "/api/analyze") {
        state.analyzeCount++;
        state.currentFail = state.failRemaining > 0;
        if (state.currentFail) state.failRemaining--;
        const img = String(parsed.image ?? "");
        state.analyzeLog.push({ n: state.analyzeCount, requestImageSha: sha(img), imageBytesSha: sha(Buffer.from(img.split(",")[1] ?? "", "base64")), description: parsed.description, garment: parsed.garment, occasion: parsed.occasion });
      }
      if (path === "/api/clarify") state.clarifyCount++;
      if (path === "/api/generate-brief") {
        const img = String(parsed.image ?? "");
        state.generateLog.push({ garment: parsed.garment, requestImageSha: img ? sha(img) : null, hasImage: Boolean(img), questions: parsed.questions?.map((q: any) => `${q.id}:${q.skipped ? "SKIPPED" : q.answer ?? ""}`) });
      }
      const web = await handler(new Request(`http://localhost${req.url}`, { method: "POST", headers: { "content-type": "application/json" }, body: raw }), provider);
      let text = await web.text();
      if (path === "/api/analyze" && state.corruptHash && web.ok) { const j = JSON.parse(text); j.data.imageHash = "0".repeat(64); text = JSON.stringify(j); }
      return send(web.status, "application/json", text);
    } catch (e) {
      return send(500, "text/plain", String(e));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}
