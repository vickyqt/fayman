/**
 * Central orchestrator: the only module API routes talk to. It sequences the
 * five agents and passes typed artifacts between them:
 *
 *   topic ──▶ [1 Archivist] chunks ──▶ [2 Diagnostic] questions
 *   answers ─▶ [2 Diagnostic] LearnerProfile ──▶ [3 Architect] LessonDraft
 *           ──▶ [5 Guardrail] GuardedBlocks ──▶ [1 Archivist] hidden Rubric
 *   teach-back ─▶ [4 Pupil] turn ──▶ [5 Guardrail] audited turn
 *   flags ───▶ [5 Guardrail] verdict (+ [3] regenerated block / rubric patch)
 *   ✦ reimagine ─▶ [3 Architect] rewritten block | lesson ──▶ [5 Guardrail] (+ [1] new rubric for a lesson)
 */
import { isMock, LLMError, providerInfo } from "@/lib/llm";
import { corpusStats, getChunks, type Chunk } from "@/lib/retrieval";
import { webSearchEnabled } from "@/lib/retrieval/web";
import { effectiveDepth, LENGTHS, withDefaults } from "@/lib/lesson-options";
import type {
  BlockType,
  DiagnosticAnswer,
  DiagnosticQuestion,
  Difficulty,
  ExtraDoc,
  LearnerProfile,
  Lesson,
  LessonBlock,
  LessonDraft,
  LessonOptions,
  RubricItem,
  TranscriptMsg,
} from "@/lib/schemas";
import { buildRubric, extractNote, gatherContext, type Context } from "./agents/archivist";
import { evaluate, generateQuestions } from "./agents/diagnostic";
import { buildLesson, reimagineBlock, reimagineLesson, type ReimagineContext } from "./agents/architect";
import { auditPupilTurn, guardLesson, guardSingle, resolveDispute, type DisputeInput } from "./agents/guardrail";
import { inScope, pupilOpening, pupilTurn, scorecard, type StatusMap } from "./agents/pupil";
import { TCP_TOPIC } from "./fixtures/tcp";

export function status() {
  return { ...providerInfo(), web: !isMock() && webSearchEnabled() ? "wikipedia" : "off", corpus: corpusStats() };
}

function publicSources(chunks: Chunk[]) {
  return chunks.map((c) => ({ id: c.id, label: c.label, url: c.url, origin: c.origin }));
}

function mockNotice(topic: string): string | undefined {
  if (!isMock()) return undefined;
  const isTcp = /tcp|handshake|syn/i.test(topic);
  return isTcp
    ? undefined
    : `Offline demo mode only ships the "${TCP_TOPIC}" lesson. Set LLM_PROVIDER in .env.local to generate "${topic}".`;
}

/** Context chunks + any chunks the blocks cite that retrieval ranked lower (citations must resolve). */
function withCited(ctx: Context, blocks: { sourceIds: string[] }[]): Chunk[] {
  const have = new Set(ctx.chunks.map((c) => c.id));
  const citedIds = [...new Set(blocks.flatMap((b) => b.sourceIds))].filter((id) => !have.has(id));
  return [...ctx.chunks, ...getChunks(citedIds, ctx.pool)];
}

/* ---------- Phase 1a: diagnostic ---------- */

export async function startDiagnostic(topic: string, extraDocs: ExtraDoc[]) {
  const ctx = await gatherContext(topic, extraDocs);
  const questions = await generateQuestions(topic, ctx.chunks, ctx.grounding);
  return {
    topic,
    questions,
    sources: publicSources(ctx.chunks),
    weakSources: ctx.weak,
    notice: mockNotice(topic),
  };
}

/* ---------- Phase 1b: lesson ---------- */

/** Guard a draft, then write the hidden rubric for it. Shared by lesson creation and full-lesson reimagine. */
async function finishLesson(topic: string, draft: LessonDraft, ctx: Context, profile: LearnerProfile, options: LessonOptions) {
  const chunks = withCited(ctx, draft.blocks);
  const guarded = await guardLesson(topic, draft, chunks, ctx.weak);
  if (!guarded.blocks.length) {
    const why = guarded.report.dropped.flatMap((d) => d.issues).slice(0, 3).join("; ");
    throw new LLMError(`Every generated section failed the quality checks${why ? ` (${why})` : ""}. Please try again.`);
  }
  const rubric = await buildRubric(topic, { ...draft, blocks: guarded.blocks }, chunks, ctx.grounding);
  const depth = effectiveDepth(options, profile.depth);
  const lesson: Lesson = {
    topic: isMock() ? TCP_TOPIC : topic,
    title: draft.title,
    summary: draft.summary,
    level: profile.level,
    depth,
    options,
    grounding: ctx.grounding,
    blocks: guarded.blocks,
  };
  const notice =
    isMock() && guarded.blocks.length < LENGTHS[options.length].min
      ? `Offline demo: the scripted lesson has ${guarded.blocks.length} sections for these settings. A real model builds the full ${LENGTHS[options.length].label.toLowerCase()} lesson.`
      : undefined;
  return { lesson, rubric, guardReport: guarded.report, sources: publicSources(chunks), notice };
}

export async function createLesson(args: {
  topic: string;
  questions: DiagnosticQuestion[];
  answers: DiagnosticAnswer[];
  options?: Partial<LessonOptions>;
  extraDocs: ExtraDoc[];
}) {
  const options = withDefaults(args.options);
  const ctx = await gatherContext(args.topic, args.extraDocs, options.length === "deep" ? 16 : 12);
  const profile = await evaluate(args.topic, args.questions, args.answers);
  const draft = await buildLesson(args.topic, profile, options, ctx.chunks, ctx.grounding);
  return { profile, ...(await finishLesson(args.topic, draft, ctx, profile, options)) };
}

/* ---------- reimagine: learner-directed rewrites ---------- */

export async function reimagine(input: {
  topic: string;
  scope: "block" | "lesson";
  instruction: string;
  block?: LessonBlock;
  preferType?: BlockType;
  outline: { id: string; type: string; title: string }[];
  profile: LearnerProfile;
  options?: Partial<LessonOptions>;
  extraDocs: ExtraDoc[];
}) {
  const options = withDefaults(input.options);
  if (input.scope === "block") {
    const notice = isMock()
      ? "Offline demo mode can't rewrite sections to your description. Set LLM_PROVIDER in .env.local to reimagine for real."
      : undefined;
    if (!input.block) throw new Error("Missing block to reimagine");
    // Focus retrieval on this section (web search still runs on the topic, so ids stay stable).
    const ctx = await gatherContext(input.topic, input.extraDocs, 10, `${input.topic} ${input.block.title} ${input.instruction}`);
    const rctx: ReimagineContext = { ...input, options, chunks: withCited(ctx, [input.block]), grounding: ctx.grounding };
    const raw = await reimagineBlock(rctx, input.block, input.preferType);
    const chunks = withCited({ ...ctx, chunks: rctx.chunks }, [raw]);
    const block = await guardSingle(input.topic, { ...raw, id: input.block.id } as LessonBlock, chunks, ctx.weak);
    if (!block) throw new Error("The reimagined section failed quality checks. Try rephrasing your request.");
    block.verification.issues.unshift(`Reimagined: "${input.instruction.slice(0, 120)}"`);
    return { scope: "block" as const, block, notice };
  }

  const ctx = await gatherContext(input.topic, input.extraDocs, options.length === "deep" ? 16 : 12, `${input.topic} ${input.instruction}`);
  const draft = await reimagineLesson({ ...input, options, chunks: ctx.chunks, grounding: ctx.grounding });
  const done = await finishLesson(input.topic, draft, ctx, input.profile, options);
  // Offline, the fixture is re-shaped by the new options; only the free-text request is ignored.
  const notice =
    isMock() && input.instruction
      ? "Offline demo: applied your new length, depth and interactivity settings. Rewriting to your description needs a real model (set LLM_PROVIDER)."
      : done.notice;
  return { scope: "lesson" as const, ...done, notice };
}

/* ---------- Phase 2: teach-back ---------- */

export async function teachBackTurn(args: {
  topic: string;
  difficulty: Difficulty;
  rubric: RubricItem[];
  statuses: StatusMap;
  transcript: TranscriptMsg[];
}) {
  if (!args.transcript.some((m) => m.role === "learner")) {
    return { reply: pupilOpening(args.topic, args.difficulty), updates: [] };
  }
  const raw = await pupilTurn(args);
  return auditPupilTurn(raw, inScope(args.rubric, args.difficulty), args.transcript);
}

export async function finishTeachBack(args: {
  topic: string;
  difficulty: Difficulty;
  rubric: RubricItem[];
  statuses: StatusMap;
  transcript: TranscriptMsg[];
}) {
  return scorecard(args);
}

/* ---------- notes + disputes ---------- */

export async function captureNote(args: {
  topic: string;
  block: LessonBlock;
  state?: Record<string, unknown>;
  focus?: { title: string; detail: string };
}) {
  return extractNote(args);
}

export async function dispute(input: DisputeInput & { extraDocs?: ExtraDoc[] }) {
  const ctx = await gatherContext(input.topic, input.extraDocs ?? [], 10);
  // Keep the block's own cited chunks in context even if retrieval ranks them low.
  const chunks = withCited(ctx, input.block ? [input.block] : []);
  return resolveDispute(input, chunks, ctx.weak);
}
