# StitchBrief

Next.js 16 (App Router) + React 19 + Tailwind v4, with a server-side Meta Model API integration.

```bash
pnpm install
cp .env.example .env.local     # then set MODEL_API_KEY (server-only)
pnpm dev                       # http://localhost:3000
pnpm test                      # 72 unit tests (no network, no key needed)
pnpm exec playwright install chromium   # once
pnpm test:e2e                  # 18 real-browser upload tests (real app + real API handlers, Meta stubbed)
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
