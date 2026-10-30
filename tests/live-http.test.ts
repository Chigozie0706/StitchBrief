// Exercises the REAL HTTP path (global fetch, headers, body, JSON parsing) against a LOCAL fake server.
// This is NOT the Meta API: it proves our client sends what the docs say and that scripts/smoke-live.ts works.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSmoke } from "../scripts/smoke-live";
import { JPEG, liveAnalysisJson, liveBriefJson } from "./helpers";

const readBody = (req: IncomingMessage) => new Promise<string>((res) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => res(s)); });

test("runSmoke against a local fake Meta server: full pipeline over real HTTP", async () => {
  const seen: { path: string; auth?: string; body?: any }[] = [];
  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : undefined;
    seen.push({ path: req.url!, auth: req.headers.authorization, body });
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/v1/models") return void res.end(JSON.stringify({ object: "list", data: [{ id: "muse-spark-1.3", object: "model", created: 1, owned_by: "meta" }] }));
    const name = body?.response_format?.json_schema?.name;
    const out = name === "garment_analysis" ? liveAnalysisJson : name === "followup_questions" ? { questions: [] } : name === "sewing_brief" ? liveBriefJson : null;
    if (!out) { res.statusCode = 400; return void res.end(JSON.stringify({ error: { message: "unexpected", type: "invalid_request_error", code: null } })); }
    res.end(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(out), refusal: null } }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as { port: number }).port;
    const dir = mkdtempSync(join(tmpdir(), "sb-"));
    const img = join(dir, "outfit.jpg");
    writeFileSync(img, Buffer.from(JPEG.split(",")[1], "base64"));
    const config = { apiKey: "LLM_1_local_test_key", model: "muse-spark-1.3", baseUrl: `http://127.0.0.1:${port}/v1` };

    const report = await runSmoke(config, img, "A burgundy dress with a higher neckline");
    assert.equal(report.ok, true, JSON.stringify(report.steps));
    assert.deepEqual(report.steps.map((s) => s.name.split(" ")[0]), ["GET", "analyze", "clarify", "generate-brief"]);

    const chats = seen.filter((s) => s.path === "/v1/chat/completions");
    assert.equal(chats.length, 3);
    for (const c of chats) {
      assert.equal(c.auth, "Bearer LLM_1_local_test_key");
      assert.equal(c.body.model, "muse-spark-1.3");
      assert.equal(c.body.response_format.type, "json_schema");
      assert.equal(c.body.max_completion_tokens, 8000);
      assert.equal(c.body.messages[0].role, "system");
      assert.equal(c.body.messages.length, 2);
    }
    const imgPart = chats[0].body.messages[1].content.find((p: any) => p.type === "image_url");
    assert.match(imgPart.image_url.url, /^data:image\/jpeg;base64,/);
    // the key and image never appear in the report text
    assert.doesNotMatch(JSON.stringify(report), /LLM_1_local_test_key|base64/);
    // follow-up call carries the answer chosen by the smoke script
    const clarifyText = chats[1].body.messages[1].content[0].text as string;
    assert.match(clarifyText, /ANSWERED: Fitted/);
  } finally {
    server.close();
  }
});

test("runSmoke reports a failing step safely (HTTP 401 from the server)", async () => {
  const server = createServer((req, res) => { res.statusCode = 401; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: { message: "bad key LLM_1_leak", type: "authentication_error", code: "invalid_api_key" } })); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as { port: number }).port;
    const dir = mkdtempSync(join(tmpdir(), "sb-"));
    const img = join(dir, "o.jpg"); writeFileSync(img, Buffer.from(JPEG.split(",")[1], "base64"));
    const report = await runSmoke({ apiKey: "k", model: "muse-spark-1.3", baseUrl: `http://127.0.0.1:${port}/v1` }, img, "desc");
    assert.equal(report.ok, false);
    assert.match(report.steps.find((s) => !s.ok)!.detail, /HTTP 401 invalid_api_key.*MODEL_API_KEY/);
    assert.doesNotMatch(JSON.stringify(report), /LLM_1_leak/);
  } finally { server.close(); }
});
