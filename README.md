# StitchBrief

Next.js 16 (App Router) + React 19 + Tailwind v4, with a server-side Meta Model API integration.

```bash
pnpm install
cp .env.example .env.local     # then set MODEL_API_KEY (server-only)
pnpm dev                       # http://localhost:3000
pnpm test                      # unit tests (no network, no key needed)
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
"# StitchBrief" 
