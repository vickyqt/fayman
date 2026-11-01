# Feynman Lab

**Learn it by doing. Prove it by teaching.** An adaptive tech-learning app where a Teacher agent builds a
Brilliant-style interactive lesson grounded in trusted GitHub repos, and a Pupil agent tests you with the
Feynman technique: you explain, it probes, and a live rubric turns green or red.

Hackathon MVP · Next.js 16 + React 19 + zod 4 + TypeScript · provider-agnostic LLM layer · runs fully offline in demo mode.
Requires Node.js 20.9 or newer.

---

## Quick start

```bash
npm install
cp .env.example .env.local      # LLM_PROVIDER=mock works with no key
npm run dev                     # http://localhost:3000
```

Pick **TCP 3-Way Handshake** for the offline demo. The whole loop works with no network:
diagnostic → personalised lesson → notes → teach-back → scorecard → disputes.

### Use a real model (any topic)

Set one provider in `.env.local`:

| `LLM_PROVIDER` | Needs | Default model (`LLM_MODEL` overrides) |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-5-5` |
| `openai` | `OPENAI_API_KEY` | `gpt-4.1-mini` |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-flash` |
| `openai-compatible` | `OPENAI_COMPATIBLE_BASE_URL` (+ key if needed) | `llama3.1` (Ollama, Groq, Together, vLLM, LM Studio…) |
| `mock` | nothing | scripted TCP lesson |

Model names change often; set `LLM_MODEL` to whatever your account offers. Adapters are plain `fetch`
calls in `lib/llm/index.ts`, so adding a provider is ~30 lines. OpenAI reasoning models (`o*`, `gpt-5*`) work too: the
adapter sends `max_completion_tokens` and leaves their temperature alone.

Each model call gets a timeout sized to its output (60 s up to 240 s for a Deep-dive lesson), always capped by what is
left of the route's `maxDuration`. When time runs short, the optional fidelity audit and block regeneration are skipped
(listed in the lesson's guard report as `skippedForTime`) instead of the request being killed. `LLM_TIMEOUT_MS` sets
a fixed per-call timeout if you need one.

### Ground lessons in trusted repos

```bash
npm run ingest            # pulls markdown listed in config/trusted-repos.json → data/corpus.json
npm run ingest -- docker  # only repos whose name contains "docker"
```

Exact file paths are downloaded from `raw.githubusercontent.com` (no API rate limit). Directory prefixes use
the GitHub tree API, so set `GITHUB_TOKEN` if you list folders. Restart the server after ingesting.
Ingest never fails the process: a repo that can't be fetched keeps its previously ingested files, so it is safe to run
in a deploy build (see [Deploy on Vercel](#deploy-on-vercel)).
The default list covers the suggested topics: system-design-primer, react-fiber-architecture, react.dev,
docker/docs networking, cstack/db_tutorial (B-trees), RAG_Techniques, and MDN's TCP pages.

Learners can also upload `.md` / `.txt` syllabus notes on the home page (up to 10 files, 200k characters each;
re-uploading a file replaces it). They're ranked alongside the repos for that browser session.

### Any topic

With a real provider, every topic is also searched on **Wikipedia** (no key needed; `WEB_SEARCH=off` disables it,
`WEB_SEARCH_LANG` picks the edition). Results are chunked per section and cited with deep links, exactly like repo
files. If sources are still thin, the Teacher may use well-established general knowledge; those sections are
labelled **◇ model knowledge** instead of being presented as sourced.

### Shape and reshape the lesson

- After the diagnostic questions (same screen), pick **Length** (Quick / Standard / Deep dive), **Depth** (Auto from
  your answers, or Foundations / Mechanisms / Edge cases) and **Interactive content** (Light → All in).
- Once the lesson is built, a banner explains that every section can be changed. Click the **✦** beside any section
  title to describe what you imagined (or turn it into another widget type); only that section is rewritten and
  re-checked, with **↶ Undo**. **Reimagine whole lesson** rebuilds everything from a description and/or new options.

### Theme

Light, dark or follow the OS: toggle in the top bar (saved per browser, applied before first paint).

---

## Deploy on Vercel

Vercel detects the project as **Next.js**. Use these project settings (Settings → Build and Deployment):

| Setting | Value |
|---|---|
| Framework Preset | **Next.js** |
| Build Command | `npm run build:vercel` (ingests the trusted repos, then `next build`) |
| Output Directory | leave empty: the Next.js preset handles it (`.next`). Don't override it |
| Install Command | `npm install` (the default; `npm ci` also works, `package-lock.json` is committed) |
| Development Command | `next dev` (the default; only used by `vercel dev`) |
| Node.js Version | 22.x or 24.x (Next 16 needs ≥ 20.9; `package.json` declares it in `engines`) |

Why `build:vercel`: `data/corpus.json` is gitignored, so a plain `next build` deploys only the seed notes and
Wikipedia. `npm run build:vercel` runs `npm run ingest` first; `next.config.mjs` traces `data/**` and `content/**`
into the API functions. If the repos can't be fetched, ingest just warns and the build still succeeds.

**Environment variables** (Settings → Environment Variables): `LLM_PROVIDER` plus the matching key
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` or `OPENAI_COMPATIBLE_BASE_URL`/`_API_KEY`), and optionally
`LLM_MODEL`, `WEB_SEARCH`, `WEB_SEARCH_LANG`, `LLM_TIMEOUT_MS`, and `GITHUB_TOKEN` (only needed if you list folders
in `config/trusted-repos.json`). Without `LLM_PROVIDER` the deployment runs the offline demo.

**Function duration:** `/api/lesson` and `/api/reimagine` declare `maxDuration = 300` (dispute 120 s, others 30–60 s).
That needs **Fluid compute** (on by default for new projects; Settings → Functions), which allows up to 300 s on Hobby
and 800 s on Pro. With Fluid compute off, Hobby is limited to 60 s and long lessons will fail.

On Vercel, `data/disputes.jsonl` can't be written (read-only filesystem), so dispute decisions are recorded in the
function logs instead.

---

## How it works

```
topic ─▶ ① Archivist ── chunks ──▶ ② Diagnostic ── 3–4 questions
answers ─▶ ② Diagnostic ── LearnerProfile ──▶ ③ Sandbox Architect ── LessonDraft (JSON props)
        ─▶ ⑤ Guardrail ── checked, cited blocks ──▶ ① Archivist ── hidden rubric
explain ─▶ ④ Pupil ── question + rubric updates ──▶ ⑤ Guardrail ── audited updates
flag    ─▶ ⑤ Guardrail ── verdict ──▶ ③ regenerated block / rubric patch / re-grade
```

`lib/orchestrator.ts` is the only thing the API routes call; it sequences the agents and passes typed
artifacts (all defined with zod in `lib/schemas/index.ts`).

| Agent | File | What it does |
|---|---|---|
| ① Coursework & Repo Archivist | `lib/agents/archivist.ts` | Retrieves grounded chunks (BM25 over repos + seed notes + uploads), writes the hidden ground-truth rubric, extracts short notes. |
| ② Diagnostic Assessor | `lib/agents/diagnostic.ts` | Writes 4 calibration questions (mental model → implementation). Scores deterministically (deeper questions weigh more), then the LLM names misconceptions → `LearnerProfile`. |
| ③ Sandbox Architect | `lib/agents/architect.ts` | Emits a lesson as JSON props for the component registry, shaped by the learner's length / depth / interactivity options; rewrites one block or the whole lesson on request (✦ reimagine). Never emits HTML or JS. |
| ④ Socratic Protégé | `lib/agents/pupil.ts` | Naive classmate persona. One question per turn, scaled to Easy / Medium / Difficult; Difficult plants plausible misconceptions. |
| ⑤ Compliance Manager | `lib/agents/guardrail.ts` | Structural checks & repair, citation resolution, LLM fidelity audit with one regeneration, Pupil audit, dispute resolution + log. |

### Zero-hallucination guardrails (Agent 5)

- **Schema-first output.** Every LLM response is parsed with zod; failures are fed back to the model for
  self-repair (`completeJSON`, 2 retries). Unknown keys are stripped, so there's no way to inject colors,
  HTML or event handlers.
- **Formulas, not code.** Slider outputs are expressions evaluated by a tiny sandboxed parser
  (`lib/expr.ts`: arithmetic, comparisons, `min/max/log/...`). Expressions that don't compile at the
  default values are dropped before they reach the browser.
- **Structural repair.** Edges to missing nodes, steps on unknown lanes, out-of-range answer indexes,
  trace lines past the end of the code, pre-drawn challenge edges, overlapping nodes: fixed or dropped,
  and listed on the block's "auto-repaired" badge.
- **Citations can't be invented.** The model cites chunk ids; the server resolves them to URLs (GitHub file
  + heading anchor). Unknown ids are removed. A block with no real source is labelled **unverified**.
- **Fidelity audit.** One LLM pass checks every block's claims against its sources; unsupported blocks
  are regenerated once, otherwise flagged.
- **Honest grading, both ways.** A concept only turns green if the Pupil's quoted evidence overlaps what the learner
  actually said. It only turns red if the latest message really says something wrong (the quote is the learner's) or
  dodged the question the Pupil just asked about it. Ungrounded updates are dropped.
- **Learner advocacy.** "⚑ Flag issue" on any block and "Unfair?" on any red rubric item send a dispute;
  the agent regenerates the block, rewrites the rubric item or re-grades, and appends to
  `data/disputes.jsonl`. Only an upheld dispute changes anything: a rejected one never regrades or patches.
- **Render isolation.** Each block has its own error boundary with a "Report & regenerate" button, so one
  bad widget never takes down the lesson.

### The component registry (Server-Driven UI)

`components/blocks/registry.tsx` maps block `type` → React component. The prompt that describes these to
the model is `REGISTRY_SPEC` in `lib/agents/architect.ts`; keep the two in sync with `lib/schemas`.

| type | Component | Learner can |
|---|---|---|
| `concept` | `ConceptBlock` | read, hear narration |
| `slider` | `InteractiveSliderBlock` | drag parameters, watch outputs turn green/red, see a sweep chart |
| `stepper` | `FlowStepperDiagram` | play/pause/step a sequence diagram, switch failure scenarios, inspect state vars, narrate |
| `architecture` | `DraggableArchitectureCanvas` (React Flow) | drag nodes, click nodes/edges for deep dives, draw missing edges in a challenge |
| `code` | `ConceptCodeTracer` | step through code with live variables |
| `predict` | `PredictionBlock` | commit to a prediction before the reveal |

**Adding a widget:** add a zod schema to the `LessonBlock` union, describe it in `REGISTRY_SPEC`, add
structural checks in `checkBlock()`, build the component, register it.

### Design system

Exactly five semantic colors (`app/globals.css`): white surfaces, black type/2px borders/grid,
**blue = anything you can move**, **green = valid / mastered**, **red = errors / gaps**. The model never
picks colors; it sets `status: ok | error | neutral` and the renderer maps it.

### Voice

Browser Web Speech API: block narration and "Narrate while playing" on steppers (TTS), the Pupil's voice
(TTS, a different voice where available), and hands-free explanations via the 🎙 button (STT, Chrome/Edge/Safari).
`lib/client/speech.ts` works around browser quirks: long text is spoken in sentence chunks (Chrome's ~15 s
cutoff), interrupted narrations never fire their "finished" callback, dictation auto-restarts after pauses and is
aborted on Send so late results can't refill the box.

### Persistence

Topic folders (notes with widget snapshots, teach-back scores) and the current session live in
`localStorage`; "Export .md" downloads a study sheet. Swap `lib/client/store.ts` for a database when you
need accounts.

---

## Project layout

```
app/                    pages (home, /study) + API routes (diagnostic, lesson, reimagine, pupil, scorecard, notes, dispute, status)
components/blocks/      component registry + the 6 interactive widgets
components/workspace/   split-screen workspace, diagnostic, notes drawer, Pupil panel
lib/agents/             the 5 agents
lib/orchestrator.ts     sequences agents; the only module routes call
lib/llm/                provider-agnostic adapter + validated JSON with self-repair
lib/retrieval/          markdown chunking (heading-anchored), BM25 index, corpus loading, Wikipedia search (web.ts)
lib/lesson-options.ts   what Length / Depth / Interactivity mean (shared by UI, prompts and mock)
lib/limits.ts           request size limits shared by the API schemas and the UI
lib/schemas/            zod contracts for every artifact
lib/fixtures/tcp.ts     offline demo content (also a reference for good agent output)
content/seed/           curated seed notes (TCP, cites IETF RFCs)
config/trusted-repos.json   the allow-list for ingestion
scripts/ingest-github.mjs   repo → data/corpus.json
```

## Demo script (≈3 minutes)

1. Home → **TCP 3-Way Handshake**. Answer the 4 diagnostic questions (get one wrong on purpose).
2. Lesson: step through the handshake, switch to **SYN-ACK lost** (red), drag RTT/loss sliders, solve the
   state-machine challenge, step the SYN-cookie trace. Hit **＋ Capture** on a few things.
3. **Teach the Pupil** → Medium. Explain the handshake, then claim "two messages would be enough" — watch
   it go red. Finish → scorecard → **Review block →** jumps back to the exact widget.
4. Click **Unfair?** on a red item or **⚑ Flag issue** on a block to show the quality agent.
5. Notes → **Export .md**.

## Known limits / next steps

- Uploads accept Markdown/text; add PDF parsing (e.g. `pdfjs-dist`) in the home page uploader.
- Retrieval is BM25. For large corpora, swap `retrieve()` for embeddings (pgvector, Chroma); the `Chunk`
  contract and citation flow stay the same.
- Offline mode only ships the TCP lesson; every other topic needs a provider. Offline, lesson options trim the
  fixture, and ✦ reimagine can't rewrite to a description.
- Storage is per-browser; add auth + a DB for multi-device folders and syllabus tracking.
