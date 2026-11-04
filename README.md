# StitchBrief

**From inspiration to a brief your tailor can work with.**

StitchBrief is an AI-powered application that helps independent fashion designers and tailors turn client inspiration images and informal descriptions into structured, editable garment briefs.

An inspiration image can communicate the general appearance of an outfit, but important details about fit, fabric preferences, finishing, measurements and construction may remain unclear. StitchBrief addresses this communication gap through visual analysis, guided clarification and structured brief generation.

## How It Works

1. **Create a brief:** Upload a garment reference image, describe the client's request, and select the garment type and occasion.
2. **Analyse the reference:** Meta Muse Spark analyses the image alongside the client's description and identifies visible design characteristics.
3. **Clarify decisions:** StitchBrief identifies missing, ambiguous or conflicting information and asks targeted follow-up questions.
4. **Generate the brief:** Client responses and validated observations are assembled into an editable garment brief.
5. **Review:** The designer reviews confirmed decisions, unresolved questions, unknown details and measurements that still need to be collected.

## Design Principles

- Visual observations are not treated as client approval.
- AI suggestions are not presented as confirmed requirements.
- Exact measurements are never inferred from photographs.
- Fabric appearance is not treated as proof of physical fabric composition.
- Unresolved decisions remain visible instead of being silently filled with assumptions.
- The generated document is a starting point for tailor review, not an automatic sewing pattern or production specification.

## Technology Stack

| Technology | Purpose |
|---|---|
| Next.js 16 (App Router) | Application framework and API routes |
| React 19 | User interface |
| TypeScript | Application logic and type safety |
| Tailwind CSS v4 | Styling |
| Meta Model API | Multimodal image and text analysis |
| Muse Spark 1.3 | AI model |
| Playwright | Browser-based end-to-end testing |
| pnpm | Package management |

## Getting Started

### Prerequisites

- Node.js
- pnpm
- A Meta Model API key for live mode

### Installation

```bash
pnpm install
```

Create your local environment file:

```bash
cp .env.example .env.local
```

Configure the required environment variables in `.env.local`.

Start the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Purpose |
|---|---|
| `MODEL_API_KEY` | Server-side Meta Model API key |
| `META_MODEL` | Meta model identifier; defaults to `muse-spark-1.3` |
| `MOCK_MODE` | Enables deterministic mock responses when set to `true` |
| `META_REASONING_EFFORT` | Configures the model's reasoning effort |

Never expose `MODEL_API_KEY` in client-side code or commit it to version control.

## Application Modes

### Live Mode

When `MODEL_API_KEY` is configured and `MOCK_MODE` is not enabled, the application calls the Meta Model API:

`https://api.meta.ai/v1/chat/completions`

The configured model defaults to `muse-spark-1.3`.

### Mock Mode

When no API key is configured, or `MOCK_MODE=true`, the application uses deterministic mock responses.

Mock mode is clearly labelled in the interface. The uploaded image is not actually analysed in this mode.

### Verify API Access

Open:

`/api/health?verify=1`

This checks the API configuration and lists the models accessible to the configured key.

## Image Upload Workflow

- Supports JPEG, PNG and WebP images up to 10 MB.
- Provides clear messages for unsupported formats, including HEIC, and oversized files.
- Keeps the current image when an invalid replacement is selected.
- Small, upright images are sent byte-for-byte unchanged.
- Images over 4 MB or 4096 pixels, or JPEGs with EXIF rotation, are re-rendered with a maximum dimension of 2560 pixels and JPEG quality of 92%.
- Resized images are labelled accordingly.
- Image previews use `object-fit: contain` so the reference is not cropped.
- The server returns a SHA-256 hash of the analysed image. The client rejects results if the hash does not match the selected image.
- Replacing an image triggers a new analysis. Previous image observations are not carried over, while earlier answers are retained but must be re-confirmed.
- Garment type is treated as a hint. The model identifies the garments it sees, and conflicts with the user's selection are flagged for designer review.

## Decisions, Questions and Brief Generation

Every detail is represented as a decision with a status and a separately maintained origin.

| Status | Meaning |
|---|---|
| `observed` | Visible in the reference image |
| `client_confirmed` | Explicitly stated by the client, or confirmed/edited by the designer |
| `ai_suggested` | Proposed by the AI, never approved |
| `uncertain` | Information exists but is ambiguous, disputed or unreliable, with a reason |
| `unknown` | Not enough information is available |
| `needs_measurement` | Requires direct measurement or fitting |

### Decision Integrity

- Source rules are enforced in code (`src/lib/decisions.ts`), not only through prompts. The model cannot mark something client-confirmed without a client statement.
- A visible detail never becomes client-confirmed simply because it appears in the reference image.
- **Mark uncertain** keeps a detail in the brief but moves it out of confirmed decisions. It makes no model call and can be reversed using **Undo uncertain** or **Confirm**.
- The brief's Confirmed, Uncertain/unresolved, Unknown and AI suggestion sections are assembled in code using a decision ledger (`src/lib/assemble.ts`).
- A newer decision on the same topic replaces the older one, preventing contradictory versions from appearing.
- Fabric answers are recorded as preferences. The brief always states that no physical fabric has been approved.
- Questions are optional. The application allows at most one initial clarification round and one follow-up round.
- Topics already asked or confirmed are not asked again, with checks performed per garment.
- A photograph containing several garments is not automatically treated as a multi-piece outfit. The designer selects which garment or garments the brief covers; other garments remain reference context.
- Marking a brief as ready means **ready for tailor review**. The review step continues to show unresolved decisions and outstanding information.

## API Routes

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/analyze` | Analyse the reference image and client description |
| POST | `/api/clarify` | Generate targeted clarification questions |
| POST | `/api/generate-brief` | Generate the structured garment brief |
| GET | `/api/health` | Check application and API health |

## Testing

The project includes unit tests and real-browser end-to-end tests.

### Unit Tests

```bash
pnpm test
```

98 unit tests run without network access or an API key.

### End-to-End Tests

Install the Playwright Chromium browser once:

```bash
pnpm exec playwright install chromium
```

Run the browser tests:

```bash
pnpm test:e2e
```

The suite includes 24 real-browser tests using the real application and API handlers, with the Meta API stubbed.

### Type Checking and Production Build

```bash
pnpm typecheck && pnpm build
```

### Live API Smoke Test

To test the actual Meta API integration:

```bash
pnpm smoke:live ./outfit.jpg "Client wants this dress with a higher neckline"
```

The smoke test performs:

1. GET `/models`
2. Image analysis with structured output
3. Clarification
4. Brief generation

It prints PASS/FAIL results for each step without printing the API key or image.

Run this test after configuring a valid `MODEL_API_KEY`.

## Known Limitations

- Rate limiting is in-memory per server instance and is not production-grade.
- Drafts are stored in browser `localStorage`, with thumbnails only. They are automatically dropped if storage quota is exceeded.
- Authentication and persistent database storage are not implemented.
- Topic matching uses a small synonym table. An unlisted synonym from the model may occasionally slip through as a repeated open item.
- Model-written prose, including fit and construction text, is guarded by prompts and validation, but not fully enforced in code beyond the sections described above.
- The application does not determine exact body measurements, guarantee fabric composition or replace professional fitting and construction decisions.

## Deployment

Live application:

[https://stitchbrief.vercel.app/](https://stitchbrief.vercel.app/)

For production deployments, configure the required environment variables in the hosting provider's environment settings.

Keep API credentials server-side and enable live mode when Meta Model API access is configured.

## Repository

[GitHub – StitchBrief](https://github.com/Chigozie0706/StitchBrief)

## Project Status

StitchBrief was developed for the **Meta Global AI Developer Hackathon 2026**.

The project demonstrates an end-to-end workflow for converting garment inspiration into a structured, editable brief, with Meta Muse Spark powering multimodal image analysis and the clarification process.

The current implementation is an MVP. Authentication, persistent database storage and production-grade distributed rate limiting remain future improvements.
