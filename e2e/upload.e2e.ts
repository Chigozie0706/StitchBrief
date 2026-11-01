// Real-browser regression tests for the upload workflow (Chromium via Playwright).
// The app and API handlers are the real code; only Meta's model is stubbed (see e2e/server.ts).
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { startServer } from "./server";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
let browser: Browser, ctx: BrowserContext, page: Page, url: string, stop: () => Promise<void>;

before(async () => {
  ({ url, close: stop } = await startServer());
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); await stop?.(); });
beforeEach(async () => {
  await ctx?.close();
  await fetch(`${url}/__reset`);
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
});

const post = (path: string, body: unknown) => fetch(url + path, { method: "POST", body: JSON.stringify(body) });
const state = async () => (await fetch(`${url}/__state`)).json() as Promise<any>;
const fileInput = () => page.getByTestId("file-input");
const analyzeBtn = () => page.locator(".form-panel button.primary");
const status = () => page.getByTestId("upload-status");

async function newBrief() {
  await page.goto(url);
  await page.getByRole("button", { name: "New brief" }).first().click();
  await page.locator("textarea").waitFor();
}
/** Draws a real image in the browser and returns its encoded bytes. */
async function makeImage(w: number, h: number, type = "image/jpeg", variant = 0): Promise<Buffer> {
  const b64 = await page.evaluate(({ w, h, type, variant }) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, variant ? "#1d3b6d" : "#6d1f2f"); g.addColorStop(1, "#f6f0e4");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = "#222"; x.fillRect(w * 0.4, h * 0.1, w * 0.2, h * 0.7);
    return c.toDataURL(type, 0.9).split(",")[1];
  }, { w, h, type, variant });
  return Buffer.from(b64, "base64");
}
const pick = (name: string, mimeType: string, buffer: Buffer) => fileInput().setInputFiles({ name, mimeType, buffer });
const describe = (text = "I love the colour and flow, but I want a higher neckline.") => page.locator("textarea").fill(text);
async function uploadAndAnalyze(buf?: Buffer, name = "look.jpg") {
  await pick(name, "image/jpeg", buf ?? (await makeImage(900, 1300)));
  await page.locator(".preview img").waitFor();
  await describe();
  await analyzeBtn().click();
  await page.getByTestId("analysis-status").waitFor();
}
async function answerAndGenerate() {
  await page.getByTestId("question-fit").getByRole("button", { name: "Fitted" }).click();
  await page.getByTestId("question-changes").getByRole("button", { name: /^Skip/ }).click();
  await page.locator(".questions button.primary").click();
  await page.locator("input.doc-title").waitFor();
}

/* ---------- 1. selecting and previewing valid formats ---------- */
for (const [label, type, ext] of [["JPEG", "image/jpeg", "jpg"], ["PNG", "image/png", "png"], ["WebP", "image/webp", "webp"]] as const) {
  test(`valid ${label}: preview, unaltered bytes sent, same bytes reach the model`, async () => {
    await newBrief();
    const buf = await makeImage(900, 1300, type);
    await pick(`look.${ext}`, type, buf);
    await page.locator(".preview img").waitFor();
    const meta = await page.getByTestId("file-meta").innerText();
    assert.match(meta, new RegExp(`look\\.${ext} · 900×1300`));
    assert.doesNotMatch(meta, /resized/, "small, upright images are not re-encoded");
    assert.match(await status().innerText(), /Image ready/);
    await describe(); await analyzeBtn().click();
    await page.getByTestId("analysis-status").waitFor();
    const s = await state();
    assert.equal(s.analyzeLog[0].imageBytesSha, sha(buf), "server received the exact bytes of the selected file");
    assert.equal(s.analyzeLog[0].modelImageSha, s.analyzeLog[0].requestImageSha, "the model call carries the same image");
    assert.match(await page.getByTestId("analysis-status").innerText(), /Analysis complete/);
  });
}

/* ---------- 2. unsupported / oversized / replacing / removing ---------- */
test("unsupported formats and oversize files are rejected with clear messages, keeping the current image", async () => {
  await newBrief();
  const gif = Buffer.from("R0lGODlhAQABAAAAACw=", "base64");
  await pick("a.gif", "image/gif", gif);
  assert.match(await page.getByTestId("upload-error").innerText(), /GIF files aren’t supported.*JPEG, PNG or WebP/);
  assert.equal(await page.locator(".preview img").count(), 0);
  await pick("IMG_0042.HEIC", "image/heic", gif);
  assert.match(await page.getByTestId("upload-error").innerText(), /HEIC photos aren’t supported/);
  await pick("huge.jpg", "image/jpeg", Buffer.alloc(11_000_000, 1));
  assert.match(await page.getByTestId("upload-error").innerText(), /11\.0 MB\. The limit is 10 MB/);
  await pick("fake.jpg", "image/jpeg", Buffer.from("not really an image"));
  assert.match(await page.getByTestId("upload-error").innerText(), /could not be read as an image/);
  assert.equal(await page.locator(".preview img").count(), 0);
  // a valid image works afterwards and clears the error
  await pick("ok.png", "image/png", await makeImage(800, 1100, "image/png"));
  await page.locator(".preview img").waitFor();
  assert.equal(await page.getByTestId("upload-error").count(), 0);
  // choosing an invalid file later does NOT discard the good one
  await pick("bad.gif", "image/gif", gif);
  assert.match(await page.getByTestId("upload-error").innerText(), /GIF/);
  assert.match(await page.getByTestId("file-meta").innerText(), /ok\.png/);
});

test("remove and replace: the description survives; analyze is blocked without an image", async () => {
  await newBrief();
  await pick("one.jpg", "image/jpeg", await makeImage(800, 1100));
  await page.locator(".preview img").waitFor();
  await describe("Keep this text");
  assert.equal(await analyzeBtn().isEnabled(), true);
  await page.getByRole("button", { name: /Remove/ }).click();
  assert.equal(await page.locator(".preview img").count(), 0);
  assert.equal(await page.locator(".dropzone").count(), 1);
  assert.equal(await analyzeBtn().isDisabled(), true, "no image → cannot analyze");
  assert.equal(await page.locator("textarea").inputValue(), "Keep this text");
  await pick("two.jpg", "image/jpeg", await makeImage(700, 1000, "image/jpeg", 1));
  await page.locator(".preview img").waitFor();
  await pick("three.jpg", "image/jpeg", await makeImage(640, 960, "image/jpeg", 0));
  await page.waitForFunction(() => document.querySelector('[data-testid="file-meta"]')?.textContent?.includes("three.jpg"));
  assert.match(await page.getByTestId("file-meta").innerText(), /three\.jpg · 640×960/);
  assert.equal(await page.locator("textarea").inputValue(), "Keep this text");
});

/* ---------- 3. preview quality ---------- */
test("previews never crop: portrait and landscape images use object-fit: contain", async () => {
  await newBrief();
  await pick("portrait.jpg", "image/jpeg", await makeImage(600, 1500));
  await page.locator(".preview img").waitFor();
  assert.equal(await page.locator(".preview img").evaluate((e) => getComputedStyle(e).objectFit), "contain");
  await describe(); await analyzeBtn().click();
  await page.locator("img.reference-image").waitFor();
  assert.equal(await page.locator("img.reference-image").evaluate((e) => getComputedStyle(e).objectFit), "contain");
  const box = await page.locator("img.reference-image").evaluate((e: HTMLImageElement) => ({ nw: e.naturalWidth, nh: e.naturalHeight, h: e.getBoundingClientRect().height }));
  assert.ok(box.h <= 520 + 1, "tall images are limited by max-height, not cropped");
});

test("large images are downscaled (not cropped); small ones get an advisory; rotated phone photos are corrected", async () => {
  await newBrief();
  await pick("big.jpg", "image/jpeg", await makeImage(5000, 3000));
  await page.locator(".preview img").waitFor();
  assert.match(await page.getByTestId("file-meta").innerText(), /2560×1536 · .*resized for upload/);
  assert.equal(await page.getByTestId("quality-advisory").count(), 0);
  await pick("tiny.jpg", "image/jpeg", await makeImage(320, 480));
  await page.waitForFunction(() => document.querySelector('[data-testid="file-meta"]')?.textContent?.includes("tiny.jpg"));
  assert.match(await page.getByTestId("quality-advisory").innerText(), /small \(320×480\)/);
  assert.equal(await analyzeBtn().isDisabled(), true, "advisory is not a blocker once a description exists…");
  await describe();
  assert.equal(await analyzeBtn().isEnabled(), true, "…the designer can still proceed");
  // EXIF orientation 6 (rotate 90°): a 1200×800 landscape file must come out upright 800×1200
  const jpeg = await makeImage(1200, 800);
  const tiff = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255]), exif]);
  await pick("phone.jpg", "image/jpeg", Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]));
  await page.waitForFunction(() => document.querySelector('[data-testid="file-meta"]')?.textContent?.includes("phone.jpg"));
  assert.match(await page.getByTestId("file-meta").innerText(), /phone\.jpg · 800×1200 · .*resized for upload/);
});

/* ---------- 4. lifecycle states, duplicate prevention ---------- */
test("states: uploading → upload complete/analyzing → analysis complete; controls locked; no duplicate submission", async () => {
  await newBrief();
  await post("/__control", { delayMs: 1200 });
  const buf = await makeImage(900, 1300);
  await pick("look.jpg", "image/jpeg", buf);
  await page.locator(".preview img").waitFor();
  await describe();
  const btn = analyzeBtn();
  await Promise.all([btn.dispatchEvent("click"), btn.dispatchEvent("click"), btn.dispatchEvent("click")]);
  await page.waitForSelector('[data-testid="upload-status"][data-phase="analyzing"]');
  assert.match(await status().innerText(), /Upload complete\. Analyzing visible details/);
  assert.equal(await btn.isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: /Replace image/ }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: /Remove/ }).isDisabled(), true);
  assert.equal(await page.locator("textarea").isDisabled(), true, "inputs can't drift away from what was sent");
  await page.getByTestId("analysis-status").waitFor({ timeout: 10_000 });
  const s = await state();
  assert.equal(s.analyzeCount, 1, "exactly one analysis request despite triple click");
  assert.match(await page.getByTestId("analysis-status").innerText(), /Analysis complete.*9 observations.*1 garment.*Clarification needed: 2 questions open/s);
});

/* ---------- 5. failures and retries ---------- */
test("upload failure (network): error shown, image and text kept, retry succeeds without re-entering anything", async () => {
  await newBrief();
  let n = 0;
  await page.route("**/api/analyze", (route) => (n++ === 0 ? route.abort("connectionreset") : route.continue()));
  const buf = await makeImage(900, 1300);
  await pick("look.jpg", "image/jpeg", buf);
  await page.locator(".preview img").waitFor();
  await describe("Keep me");
  await analyzeBtn().click();
  await page.getByTestId("upload-error").waitFor();
  assert.match(await page.getByTestId("upload-error").innerText(), /Could not reach the server/);
  assert.match(await status().innerText(), /Analysis failed\. Your image and description are kept/);
  assert.equal(await page.locator(".preview img").count(), 1);
  assert.equal(await page.locator("textarea").inputValue(), "Keep me");
  assert.equal(await analyzeBtn().innerText().then((t) => t.trim()), "Try again");
  await analyzeBtn().click();
  await page.getByTestId("analysis-status").waitFor();
  const s = await state();
  assert.equal(s.analyzeLog.length, 1, "only the retry reached the server");
  assert.equal(s.analyzeLog[0].imageBytesSha, sha(buf));
});

test("analysis failure (model returns unusable output): clear error, nothing lost, retry succeeds with the same image", async () => {
  await newBrief();
  await post("/__control", { failRemaining: 1 });
  const buf = await makeImage(900, 1300);
  await pick("look.jpg", "image/jpeg", buf);
  await page.locator(".preview img").waitFor();
  await describe("Same text");
  await analyzeBtn().click();
  await page.getByTestId("upload-error").waitFor();
  assert.match(await page.getByTestId("upload-error").innerText(), /did not return usable data/);
  assert.equal(await page.getByTestId("analysis-status").count(), 0, "success is NOT claimed before a validated response");
  assert.equal(await page.locator("textarea").inputValue(), "Same text");
  await analyzeBtn().click();
  await page.getByTestId("analysis-status").waitFor();
  const s = await state();
  assert.equal(s.analyzeLog.length, 2);
  assert.equal(s.analyzeLog[0].imageBytesSha, s.analyzeLog[1].imageBytesSha);
  assert.equal(s.analyzeLog[0].description, s.analyzeLog[1].description);
});

test("if the analysis comes back for a different image than the one selected, it is rejected", async () => {
  await newBrief();
  await post("/__control", { corruptHash: true });
  await uploadAndAnalyzeExpectingFailure();
  async function uploadAndAnalyzeExpectingFailure() {
    await pick("look.jpg", "image/jpeg", await makeImage(900, 1300));
    await page.locator(".preview img").waitFor();
    await describe(); await analyzeBtn().click();
    await page.getByTestId("upload-error").waitFor();
  }
  assert.match(await page.getByTestId("upload-error").innerText(), /different image than the one you selected/);
  assert.equal(await page.getByTestId("analysis-status").count(), 0);
  await post("/__control", { corruptHash: false });
  await analyzeBtn().click();
  await page.getByTestId("analysis-status").waitFor();
});

/* ---------- 6. consistency after replacing the image ---------- */
test("replacing the image re-analyzes it; old image observations are dropped, answers kept but flagged for review", async () => {
  await newBrief();
  const a = await makeImage(900, 1300, "image/jpeg", 0);
  await uploadAndAnalyze(a, "A.jpg");
  assert.match(await page.getByLabel("Dress Color").inputValue(), /analysis #1/);
  await page.getByLabel("Dress Neckline").fill("Raised V, 2cm higher");        // designer correction tied to image A
  await page.getByTestId("question-fit").getByRole("button", { name: "Fitted" }).click();
  await page.getByRole("button", { name: "Back to image and request" }).click();
  await page.locator("textarea").waitFor();
  assert.equal(await page.locator("textarea").inputValue(), "I love the colour and flow, but I want a higher neckline.");
  assert.match(await analyzeBtn().innerText(), /Continue to clarification/, "unchanged inputs → no needless re-analysis");
  const b = await makeImage(700, 1100, "image/jpeg", 1);
  await pick("B.jpg", "image/jpeg", b);
  await page.waitForFunction(() => document.querySelector('[data-testid="file-meta"]')?.textContent?.includes("B.jpg"));
  assert.match(await page.locator(".hint", { hasText: "Replacing the image" }).innerText(), /marked for review/);
  assert.match(await analyzeBtn().innerText(), /Analyze inspiration/);
  await analyzeBtn().click();
  await page.getByTestId("analysis-status").waitFor();
  // new analysis, not the old one
  assert.match(await page.getByLabel("Dress Color").inputValue(), /analysis #2/);
  assert.doesNotMatch(await page.getByLabel("Dress Neckline").inputValue(), /Raised V/);
  assert.match(await page.getByTestId("review-notes").innerText(), /Raised V, 2cm higher/);
  // earlier answer kept but flagged; generation blocked until confirmed
  assert.equal(await page.getByTestId("question-fit").getByTestId("review-flag").count(), 1);
  assert.equal(await page.locator(".questions button.primary").isDisabled(), true);
  assert.match(await page.locator(".q-reason", { hasText: "marked for review" }).innerText(), /Confirm the 1 earlier answer/);
  await page.getByTestId("question-fit").getByRole("button", { name: "Keep answer" }).click();
  await page.getByTestId("question-changes").getByRole("button", { name: /^Skip/ }).click();
  assert.equal(await page.locator(".questions button.primary").isEnabled(), true);
  const s = await state();
  assert.equal(s.analyzeLog.length, 2);
  assert.equal(s.analyzeLog[0].imageBytesSha, sha(a));
  assert.equal(s.analyzeLog[1].imageBytesSha, sha(b), "the second analysis used the replacement image");
});

test("image, description and garment stay connected from upload through to the generated brief", async () => {
  await newBrief();
  const buf = await makeImage(900, 1300);
  await page.locator("select").selectOption("Dress");
  await uploadAndAnalyze(buf);
  await answerAndGenerate();
  const s = await state();
  assert.equal(s.analyzeLog[0].description, "I love the colour and flow, but I want a higher neckline.");
  assert.equal(s.generateLog[0].requestImageSha, s.analyzeLog[0].requestImageSha, "the brief was generated from the very image that was analyzed");
  assert.equal(s.generateLog[0].garment, "Dress");
  assert.deepEqual(s.generateLog[0].questions, ["fit:Fitted", "changes:SKIPPED"]);
  assert.equal(await page.locator("input.doc-title").inputValue(), "Burgundy evening dress");
});

/* ---------- 7. multi-piece outfits ---------- */
test("two-piece outfit: top and trousers are analyzed separately; selection matches, so no warning", async () => {
  await newBrief();
  await post("/__control", { scenario: "twopiece" });
  await page.locator("select").selectOption("Two-piece set");
  await uploadAndAnalyze();
  const groups = page.getByTestId("piece-group");
  assert.equal(await groups.count(), 2);
  assert.match(await groups.nth(0).innerText(), /Top[\s\S]*Neckline[\s\S]*Sleeves/i);
  const trousers = await groups.nth(1).innerText();
  assert.match(trousers, /Trousers[\s\S]*Silhouette[\s\S]*Length/i);
  assert.doesNotMatch(trousers, /Neckline|Sleeves/i, "nothing invented for trousers");
  assert.match(await page.getByTestId("analysis-status").innerText(), /4 observations · 2 garments/);
  assert.equal(await page.getByTestId("garment-mismatch").count(), 0);
});

test("selecting the wrong garment type is flagged, never silently applied; the designer decides", async () => {
  await newBrief();                                          // image shows ONE dress, designer says two-piece
  await page.locator("select").selectOption("Two-piece set");
  await uploadAndAnalyze();
  const notice = page.getByTestId("garment-mismatch");
  assert.match(await notice.innerText(), /selected Two-piece set.*one piece \(Dress\)/s);
  await notice.getByRole("button", { name: "Use Dress" }).click();
  assert.equal(await notice.count(), 0);
  await answerAndGenerate();
  assert.equal((await state()).generateLog[0].garment, "Dress", "the confirmed garment is what the brief uses");
});

test("keeping the selection also works; 'Not sure' adopts what the image shows", async () => {
  await newBrief();                                          // two pieces shown, designer says Blouse
  await post("/__control", { scenario: "twopiece" });
  await page.locator("select").selectOption("Blouse");
  await uploadAndAnalyze();
  assert.match(await page.getByTestId("garment-mismatch").innerText(), /selected Blouse.*2 pieces \(Top and Trousers\)/s);
  await page.getByTestId("garment-mismatch").getByRole("button", { name: "Keep Blouse" }).click();
  await answerAndGenerate();
  assert.equal((await state()).generateLog[0].garment, "Blouse");
  // Not sure → no warning, label comes from the analysis
  await fetch(`${url}/__reset`); await post("/__control", { scenario: "twopiece" });
  await newBrief();
  assert.equal(await page.locator("select").inputValue(), "Not sure", "the default is 'Not sure', not a guess");
  await uploadAndAnalyze();
  assert.equal(await page.getByTestId("garment-mismatch").count(), 0);
  await answerAndGenerate();
  assert.equal((await state()).generateLog[0].garment, "Two-piece set");
  assert.equal((await state()).analyzeLog[0].garment, "", "'Not sure' is sent as no hint");
});

/* ---------- 8. clarity of the photo ---------- */
test("when the model can read little from the photo, the designer is offered a clearer image", async () => {
  await newBrief();
  await post("/__control", { scenario: "weak" });
  await uploadAndAnalyze();
  const notice = page.getByTestId("low-detail");
  assert.match(await notice.innerText(), /Not much detail was visible/);
  await notice.getByRole("button", { name: "Replace image" }).click();
  await page.locator("textarea").waitFor();
  assert.equal(await page.locator("textarea").inputValue().then((t) => t.length > 0), true);
});

/* ---------- 9. reopening a saved draft ---------- */
test("a reopened draft only has a small preview: it can continue, but not re-analyze from that preview", async () => {
  await newBrief();
  await uploadAndAnalyze();
  await answerAndGenerate();
  await page.getByRole("button", { name: /Save draft/ }).click();
  await page.reload();
  await page.getByRole("button", { name: /My briefs/ }).first().click();
  await page.getByRole("button", { name: "Open", exact: true }).first().click(); // saved drafts are listed before the demo briefs
  await page.locator("input.doc-title").waitFor();
  await page.getByRole("button", { name: /Back to clarification/ }).first().click();
  await page.getByRole("button", { name: "Back to image and request" }).click();
  await page.locator("textarea").waitFor();
  assert.match(await page.locator(".advisory").innerText(), /Only a small preview of this image is stored/);
  assert.match(await analyzeBtn().innerText(), /Continue to clarification/);
  await page.locator("textarea").fill("A different request");
  assert.equal(await analyzeBtn().isDisabled(), true, "a changed request can't be analyzed from the 480px preview");
});
