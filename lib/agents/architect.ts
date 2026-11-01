/**
 * Agent 3 — The Sandbox Architect (Teacher).
 * Turns a LearnerProfile + grounded chunks into a Server-Driven UI payload:
 * a list of blocks, each one the props for a component in the registry
 * (components/blocks/registry.tsx). It never writes HTML or code to execute.
 */
import { completeJSON, isMock } from "@/lib/llm";
import type { Chunk } from "@/lib/retrieval";
import {
  LessonBlock,
  LessonDraft,
  type BlockType,
  type Grounding,
  type LearnerProfile,
  type LessonDepth,
  type LessonOptions,
} from "@/lib/schemas";
import { budget, effectiveDepth, LENGTHS } from "@/lib/lesson-options";
import { tcpLesson } from "@/lib/fixtures/tcp";
import { formatContext, groundingRules } from "./archivist";

/** The registry contract, written for the model. Keep in sync with lib/schemas. */
export const REGISTRY_SPEC = `COMPONENT REGISTRY (the ONLY block types you may use). Every block has:
  "id" (kebab-case, unique), "type", "title" (<= 60 chars), "sourceIds" (ids of SOURCES that back it), optional "narration" (1-3 sentences read aloud).

1. "concept" — explanation card.
   { "body": markdown (paragraphs, **bold**, \`code\`, "- " bullets; respect the word limit in the lesson rules), "analogy"?: string, "keyPoints": string[] (2-4) }
2. "slider" — InteractiveSliderBlock: parameters drive live computed outputs.
   { "description", "params": [{ "name" (identifier), "label", "min", "max", "step", "default", "unit"? }] (1-3),
     "outputs": [{ "label", "expr", "unit"?, "decimals"?, "goodWhen"?, "badWhen"? }] (1-3),
     "chart"?: { "x": param name, "outputIndex": number }, "insight": string }
   expr/goodWhen/badWhen are arithmetic expressions over param names ONLY: numbers, + - * / % ^, < > <= >= == != && || ! ?:,
   functions min max abs sqrt log log2 log10 exp floor ceil round pow clamp, constants pi e. NO JavaScript, no Math., no strings.
   goodWhen true → output shown green (healthy); badWhen true → red (bottleneck). Use real formulas from the domain.
3. "stepper" — FlowStepperDiagram: a sequence diagram you step through (protocols, algorithms, request lifecycles).
   { "description", "lanes": [{ "id", "label" }] (2-4 actors), "scenarios": [{ "id", "label", "steps": [
     { "from": laneId, "to": laneId (same lane = internal action), "label" (<= 40 chars), "detail" (what happens and why),
       "status": "ok" | "error" | "neutral", "state": { "<actor>.<var>": "value" } } ] }] }
   Give 1-3 scenarios: the normal path first, then failure/edge scenarios with "error" steps.
4. "architecture" — DraggableArchitectureCanvas: nodes + edges the learner can drag and click.
   { "description", "nodes": [{ "id", "label" (<= 20 chars), "detail" (deep technical breakdown), "x", "y" }] (3-8; x 0-700, y 0-300, spread out),
     "edges": [{ "id", "source", "target", "label"?, "detail"?, "status"? }],
     "challenge"?: { "prompt", "requiredEdges": [{ "source", "target" }] (1-3 edges the learner must draw; do NOT also list them in edges), "successMessage" } }
5. "code" — ConceptCodeTracer: step through code with live variables.
   { "language", "code" (<= 25 lines), "trace": [{ "line" (1-based), "vars": { name: value }, "note", "status" }] (4-12 steps) }
6. "predict" — a single prediction question before a reveal.
   { "question", "options": string[] (3-4), "correctIndex", "explanation" }

Colors are NOT yours to choose: use "status" ("ok" = validated/correct flow, "error" = failure/bottleneck, "neutral") and the UI maps them.`;

const DEPTH_RULES: Record<LessonDepth, string> = {
  foundations: `DEPTH "foundations" (beginner): open with a concept block with an everyday analogy, then build up step by step. Define every term before using it.`,
  mechanisms: `DEPTH "mechanisms" (intermediate): a short recap, then mechanisms, cause-and-effect and failure scenarios.`,
  "edge-cases": `DEPTH "edge-cases" (advanced): skip basics entirely; go straight to edge cases, performance trade-offs, scale limits and internals.`,
};

function interactivityRule(o: LessonOptions): string {
  const b = budget(o);
  switch (o.interactivity) {
    case "max":
      return `INTERACTIVITY "all in": EVERY block must be interactive (slider / stepper / architecture / code / predict). Do NOT use "concept" blocks; put explanations in descriptions, step details, node details, insights and narration.`;
    case "rich":
      return `INTERACTIVITY "hands-on": at least ${b.interactive} interactive blocks; at most ${Math.max(1, b.concepts)} concept block(s). Never two concept blocks in a row.`;
    case "balanced":
      return `INTERACTIVITY "balanced": about ${b.interactive} interactive blocks, the rest concept blocks. Never two concept blocks in a row.`;
    case "light":
      return `INTERACTIVITY "light": mostly concept blocks (clear reading), with ${b.interactive}-${b.interactive + 1} well-chosen interactive blocks where doing beats reading.`;
  }
}

/** The lesson prompt, shaped by the learner's options. */
function lessonSystem(o: LessonOptions, depth: LessonDepth, grounding: Grounding): string {
  const len = LENGTHS[o.length];
  const extra =
    o.length === "deep"
      ? " Cover the topic end to end: the fundamentals the depth allows, mechanisms, failure modes, trade-offs and a worked example."
      : o.length === "short"
        ? " Only the essentials: the single most important idea per block."
        : "";
  return `You are the Sandbox Architect, the Teacher agent of a Brilliant.org-style learning platform.
You build ONE personalised, interactive lesson as JSON for the learner described in LEARNER PROFILE.

Return JSON: { "title": string, "summary": string (1-2 sentences), "blocks": Block[] (${len.min}-${len.max} blocks) }.

${REGISTRY_SPEC}

Lesson shape (chosen by the learner; follow it exactly):
- LENGTH "${len.label}": ${len.min}-${len.max} blocks. Concept bodies <= ${len.words} words.${extra}
- ${DEPTH_RULES[depth]}
- ${interactivityRule(o)}

Lesson design rules:
- Mix widget types; don't use the same interactive type more than twice unless the topic demands it.
- If the topic has multiple components, state transitions or a protocol, include a "stepper" or "architecture" block.
- Address the learner's listed misconceptions and gaps explicitly in at least one block.
- ${grounding === "assisted" ? "Cite sources wherever they support a block." : "Every block must have at least one sourceId."}
${groundingRules(grounding)}`;
}

function profileText(p: LearnerProfile, depth: LessonDepth): string {
  return JSON.stringify({
    level: p.level,
    depth,
    known: p.known,
    gaps: p.gaps,
    misconceptions: p.misconceptions,
    note: p.summary,
  });
}

/* ---------------- mock mode ---------------- */

/** Drop fixture blocks in priority order until `done(blocks)` holds (never below 3 blocks). */
function trim(blocks: LessonBlock[], order: string[], done: (bs: LessonBlock[]) => boolean): LessonBlock[] {
  let out = blocks;
  for (const id of order) {
    if (done(out) || out.length <= 3) break;
    out = out.filter((b) => b.id !== id);
  }
  return out;
}

/** Mock mode: personalise and shape the fixture the same way the real prompt asks the model to. */
function mockLesson(profile: LearnerProfile, options: LessonOptions): LessonDraft {
  const depth = effectiveDepth(options, profile.depth);
  let blocks = structuredClone(tcpLesson.blocks);
  let title = tcpLesson.title;
  if (depth === "edge-cases") {
    const skip = new Set(["c-why", "p-two-way"]);
    blocks = blocks.filter((b) => !skip.has(b.id));
    const edge = blocks.findIndex((b) => b.id === "c-edge");
    const [edgeBlock] = blocks.splice(edge, 1);
    blocks.splice(1, 0, edgeBlock);
    title = "TCP handshake: edge cases & trade-offs";
  } else if (depth === "mechanisms") {
    const why = blocks.find((b) => b.id === "c-why");
    if (why && why.type === "concept") why.analogy = undefined;
  }

  const interactive = (bs: LessonBlock[]) => bs.filter((b) => b.type !== "concept").length;
  if (options.interactivity === "max") blocks = blocks.filter((b) => b.type !== "concept");
  else if (options.interactivity === "light")
    blocks = trim(blocks, ["code-cookie", "a-states", "sl-latency"], (bs) => interactive(bs) / bs.length <= 0.4);
  else if (options.interactivity === "rich")
    blocks = trim(blocks, ["c-edge"], (bs) => interactive(bs) / bs.length >= 0.75);

  const max = LENGTHS[options.length].max;
  blocks = trim(blocks, ["code-cookie", "c-edge", "p-two-way", "a-states", "sl-latency"], (bs) => bs.length <= max);
  return { ...tcpLesson, title, blocks };
}

/* ---------------- lesson ---------------- */

export async function buildLesson(
  topic: string,
  profile: LearnerProfile,
  options: LessonOptions,
  chunks: Chunk[],
  grounding: Grounding = "sources",
): Promise<LessonDraft> {
  if (isMock()) return mockLesson(profile, options);
  const depth = effectiveDepth(options, profile.depth);
  return completeJSON(
    {
      tag: "architect.lesson",
      system: lessonSystem(options, depth, grounding),
      maxTokens: LENGTHS[options.length].maxTokens,
      temperature: 0.4,
      messages: [
        {
          role: "user",
          content: `TOPIC: ${topic}\n\nLEARNER PROFILE: ${profileText(profile, depth)}\n\nSOURCES:\n${formatContext(chunks)}`,
        },
      ],
    },
    LessonDraft,
  );
}

const REGEN_SYSTEM = `You are the Sandbox Architect. One block of a lesson was rejected by quality review or flagged by the learner.
Rewrite that single block to fix every listed problem while keeping the same "id" and preferably the same "type"
(switch type only if the problem is that the widget type does not fit the concept).
Return the block as a JSON object (not wrapped).

${REGISTRY_SPEC}`;

export async function regenerateBlock(
  topic: string,
  block: LessonBlock,
  problems: string[],
  chunks: Chunk[],
  grounding: Grounding = "sources",
): Promise<LessonBlock> {
  if (isMock()) {
    // Offline: return the fixture's version (a real model rewrites it).
    const original = tcpLesson.blocks.find((b) => b.id === block.id) ?? block;
    return structuredClone(original);
  }
  return completeJSON(
    {
      tag: "architect.regenerate",
      system: `${REGEN_SYSTEM}\n${groundingRules(grounding)}`,
      maxTokens: 3000,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: `TOPIC: ${topic}\n\nBLOCK:\n${JSON.stringify(block)}\n\nPROBLEMS:\n${problems
            .map((p) => `- ${p}`)
            .join("\n")}\n\nSOURCES:\n${formatContext(chunks)}`,
        },
      ],
    },
    LessonBlock,
  );
}

/* ---------------- reimagine (learner-directed rewrites) ---------------- */

export interface ReimagineContext {
  topic: string;
  instruction: string;
  profile: LearnerProfile;
  options: LessonOptions;
  chunks: Chunk[];
  grounding: Grounding;
  /** Titles + types of the current lesson, so rewrites stay coherent with it. */
  outline: { id: string; type: string; title: string }[];
}

function outlineText(outline: ReimagineContext["outline"]): string {
  return outline.map((b, i) => `${i + 1}. [${b.type}] ${b.title} (id ${b.id})`).join("\n");
}

/**
 * Rewrite ONE block the way the learner imagined it ("make it a diagram",
 * "explain with a cooking analogy", "go deeper on retries"...).
 */
export async function reimagineBlock(ctx: ReimagineContext, block: LessonBlock, preferType?: BlockType): Promise<LessonBlock> {
  if (isMock()) {
    const original = tcpLesson.blocks.find((b) => b.id === block.id) ?? block;
    return structuredClone(original);
  }
  const depth = effectiveDepth(ctx.options, ctx.profile.depth);
  const typeRule = preferType
    ? `It MUST be a "${preferType}" block (convert the content to that widget).`
    : `Keep the type unless a different widget clearly fits the request better (e.g. "make it visual" → stepper / architecture / slider; "quiz me" → predict).`;
  const system = `You are the Sandbox Architect. The learner wants to reshape ONE section of their lesson to match what they imagined.
Rewrite that single block, following the LEARNER'S REQUEST as closely as the component registry allows, while staying technically accurate.
- Keep the same "id". ${typeRule}
- Stay coherent with the rest of the lesson (LESSON OUTLINE) and pitched at depth "${depth}". Don't repeat what other blocks already cover.
- If the request asks for something the registry cannot render (video, images, audio...), use the closest widget and mention the substitution in "narration".
Return the block as a JSON object (not wrapped).

${REGISTRY_SPEC}
${groundingRules(ctx.grounding)}`;
  return completeJSON(
    {
      tag: "architect.reimagine-block",
      system,
      maxTokens: 3500,
      temperature: 0.5,
      messages: [
        {
          role: "user",
          content: `TOPIC: ${ctx.topic}\n\nLEARNER'S REQUEST: ${ctx.instruction}\n\nCURRENT BLOCK:\n${JSON.stringify(
            block,
          )}\n\nLESSON OUTLINE:\n${outlineText(ctx.outline)}\n\nLEARNER PROFILE: ${profileText(ctx.profile, depth)}\n\nSOURCES:\n${formatContext(
            ctx.chunks,
          )}`,
        },
      ],
    },
    LessonBlock,
  );
}

/** Rebuild the whole lesson around the learner's request (and possibly new options). */
export async function reimagineLesson(ctx: ReimagineContext): Promise<LessonDraft> {
  if (isMock()) return mockLesson(ctx.profile, ctx.options);
  const depth = effectiveDepth(ctx.options, ctx.profile.depth);
  const system = `${lessonSystem(ctx.options, depth, ctx.grounding)}

This is a REIMAGINED version of an existing lesson. The learner described how they want the whole lesson to look or feel.
Follow the LEARNER'S REQUEST throughout while keeping the lesson-shape rules above. Reuse good parts of the CURRENT LESSON OUTLINE
where they fit the request, but reorganise, replace or retitle freely. Use fresh kebab-case block ids.`;
  return completeJSON(
    {
      tag: "architect.reimagine-lesson",
      system,
      maxTokens: LENGTHS[ctx.options.length].maxTokens,
      temperature: 0.5,
      messages: [
        {
          role: "user",
          content: `TOPIC: ${ctx.topic}\n\nLEARNER'S REQUEST: ${
            ctx.instruction || "(no extra request: apply the new lesson shape)"
          }\n\nCURRENT LESSON OUTLINE:\n${outlineText(ctx.outline)}\n\nLEARNER PROFILE: ${profileText(
            ctx.profile,
            depth,
          )}\n\nSOURCES:\n${formatContext(ctx.chunks)}`,
        },
      ],
    },
    LessonDraft,
  );
}
