# StitchBrief

Next.js 16 (App Router) + React 19 + Tailwind v4, with a server-side Meta Model API integration.

```bash
pnpm install
cp .env.example .env.local     # then set MODEL_API_KEY (server-only)
pnpm dev                       # http://localhost:3000
pnpm test                      # 98 unit tests (no network, no key needed)
pnpm exec playwright install chromium   # once
pnpm test:e2e                  # 24 real-browser tests (real app + real API handlers, Meta stubbed)
pnpm typecheck && pnpm build
```

## Modes
- **Live**: `MODEL_API_KEY` set. Calls `https://api.meta.ai/v1/chat/completions` with `META_MODEL` (default `muse-spark-1.3`).
- **Mock**: no key (or `MOCK_MODE=true`). Deterministic, clearly labelled in the UI; the image is *not* analyzed.

Verify your key and model access: open `/api/health?verify=1` (lists the models your key can see).

### Live smoke test (real Meta API)
```bash
pnpm smoke:live ./outfit.jpg "Client wants this dress with a higher neckline"
```
Runs GET /models → analyze (image + structured output) → clarify → generate-brief against the real API and prints
PASS/FAIL per step. It never prints your key or the image. Run this before demoing.

## API routes
`POST /api/analyze` · `POST /api/clarify` · `POST /api/generate-brief` · `GET /api/health`

## Limits (honest)
Rate limiting is in-memory per server instance (not production-grade). Drafts live in browser `localStorage`
(thumbnail only; dropped automatically if the quota is exceeded). No auth, no database.

## Upload workflow
- JPEG, PNG, WebP up to 10 MB. Clear messages for other formats (including HEIC) and oversize files; the current image is kept when a bad file is chosen.
- Small, upright images are sent byte-for-byte unchanged. Images over 4 MB or 4096 px, or JPEGs with EXIF rotation, are re-rendered (max 2560 px, JPEG 92%) and labelled "resized for upload".
- Previews use `object-fit: contain`: nothing is cropped.
- The server returns a SHA-256 of the image it analysed; the client rejects the result if it doesn't match the selected image.
- Replacing the image re-analyses it. Image observations are never carried over; earlier answers are kept but must be re-confirmed.
- "Garment type" is only a hint. The model lists the garments it sees (a top and trousers are analysed separately) and any conflict with the selection is flagged for the designer to resolve.

## Decisions, questions and the brief
Every detail is a *decision* with a status and a separately-kept origin:

| Status | Meaning |
|---|---|
| `observed` | visible in the reference image |
| `client_confirmed` | explicitly stated by the client, or confirmed/edited by the designer |
| `ai_suggested` | proposed by the AI, never approved |
| `uncertain` | information exists but is ambiguous, disputed or unreliable (with a reason) |
| `unknown` | not enough information |
| `needs_measurement` | needs measuring or fitting |

- Source rules are enforced in code (`src/lib/decisions.ts`), not only in prompts: the model cannot mark anything client-confirmed without a client statement, and a visible detail never becomes confirmed by itself.
- **Mark uncertain** keeps the detail in the brief, moves it out of the confirmed decisions, makes no model call, and is reversible (**Undo uncertain**, or **Confirm**).
- The brief's *Confirmed*, *Uncertain/unresolved*, *Unknown* and *AI suggestion* sections are built in code from a **decision ledger** (`src/lib/assemble.ts`); a newer decision on the same topic replaces the older one, so no contradictory versions appear.
- Fabric answers are recorded as preferences; the brief always states that no physical fabric has been approved.
- Questions are never required. At most one initial round plus **one** follow-up round; topics already asked or confirmed are never asked again (checked per garment).
- A photo containing several garments is not assumed to be a multi-piece outfit: the designer chooses which garment(s) the brief is for; the rest are reference context only.
- "Ready" means **ready for tailor review**, and the review step lists what is still unresolved.

### Known limits
- Topic matching uses a small synonym table; an unlisted synonym from the model can slip through as a repeated open item.
- Model-written prose (fit, construction text) is guarded by prompts and validation, not by code, beyond the sections listed above.
