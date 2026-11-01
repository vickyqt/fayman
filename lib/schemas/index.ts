/**
 * Server-Driven UI contract.
 *
 * Every payload an agent produces is validated against these schemas before it
 * reaches the browser. The LLM never emits HTML, JS or colors: it emits props for
 * a fixed registry of React components, and semantic "status" values that the
 * renderer maps onto the 5-color palette (valid → green, error → red, ...).
 */
import { z } from "zod";
import { LIMITS } from "@/lib/limits";

/* ---------- shared ---------- */

export const Status = z.enum(["ok", "error", "neutral"]);
export type Status = z.infer<typeof Status>;

export const Level = z.enum(["beginner", "intermediate", "advanced"]);
export type Level = z.infer<typeof Level>;

export const Difficulty = z.enum(["easy", "medium", "difficult"]);
export type Difficulty = z.infer<typeof Difficulty>;

/** Learner-chosen shape of the generated lesson (picked after the diagnostic). */
export const LessonLength = z.enum(["short", "standard", "deep"]);
export type LessonLength = z.infer<typeof LessonLength>;

export const LessonDepth = z.enum(["foundations", "mechanisms", "edge-cases"]);
export type LessonDepth = z.infer<typeof LessonDepth>;

export const Interactivity = z.enum(["light", "balanced", "rich", "max"]);
export type Interactivity = z.infer<typeof Interactivity>;

export const LessonOptions = z.object({
  length: LessonLength.default("standard"),
  /** "auto" = use the depth the diagnostic inferred. */
  depth: z.union([z.literal("auto"), LessonDepth]).default("auto"),
  interactivity: Interactivity.default("balanced"),
});
export type LessonOptions = z.infer<typeof LessonOptions>;

/**
 * How a lesson is grounded. "sources": the retrieved corpus covers the topic.
 * "assisted": sources are thin, so blocks may fall back to the model's
 * general knowledge (and are labelled as such).
 */
export type Grounding = "sources" | "assisted";

/** A citation after the guardrail has resolved a chunk id to a real source. */
export const Citation = z.object({
  chunkId: z.string(),
  label: z.string(),
  url: z.string(),
});
export type Citation = z.infer<typeof Citation>;

const id = z.string().min(1).max(64);
const shortText = z.string().min(1).max(200);
const longText = z.string().min(1).max(4000);

/* ---------- Agent 2: diagnostic ---------- */

export const DiagnosticQuestion = z.object({
  id,
  prompt: z.string().min(5).max(400),
  depth: z.enum(["mental-model", "mechanism", "implementation"]),
  concept: shortText,
  options: z.array(z.string().min(1).max(200)).min(3).max(5),
  correctIndex: z.number().int().min(0),
});
export type DiagnosticQuestion = z.infer<typeof DiagnosticQuestion>;

export const DiagnosticSet = z.object({
  questions: z.array(DiagnosticQuestion).min(3).max(4),
});

export const DiagnosticAnswer = z.object({
  questionId: id,
  choice: z.number().int().min(-1), // -1 = "I'm not sure"
  explanation: z.string().max(LIMITS.diagnosticWhy).optional().default(""),
});
export type DiagnosticAnswer = z.infer<typeof DiagnosticAnswer>;

export const LearnerProfile = z.object({
  level: Level,
  score: z.number().min(0).max(1),
  known: z.array(z.string()).max(10),
  gaps: z.array(z.string()).max(10),
  misconceptions: z.array(z.string()).max(10),
  depth: LessonDepth,
  summary: z.string().max(600),
});
export type LearnerProfile = z.infer<typeof LearnerProfile>;

/* ---------- Agent 3: lesson blocks (the component registry contract) ---------- */

const blockBase = {
  id,
  title: shortText,
  /** Chunk ids from the retrieved context. Resolved to Citations by Agent 5. */
  sourceIds: z.array(z.string()).max(6).default([]),
  /** Optional text the Teacher reads aloud (TTS). */
  narration: z.string().max(1500).optional(),
};

export const ConceptBlock = z.object({
  ...blockBase,
  type: z.literal("concept"),
  body: longText, // small markdown subset: paragraphs, **bold**, `code`, - lists
  analogy: z.string().max(600).optional(),
  keyPoints: z.array(z.string().max(240)).max(6).default([]),
});

export const SliderParam = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  label: shortText,
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  default: z.number(),
  unit: z.string().max(16).optional(),
});

export const SliderOutput = z.object({
  label: shortText,
  /** Safe arithmetic expression over param names, e.g. "3 * rtt / 2". */
  expr: z.string().min(1).max(300),
  unit: z.string().max(16).optional(),
  decimals: z.number().int().min(0).max(4).default(1),
  /** Boolean expressions: green when goodWhen is true, red when badWhen is true. */
  goodWhen: z.string().max(300).optional(),
  badWhen: z.string().max(300).optional(),
});

export const SliderBlock = z.object({
  ...blockBase,
  type: z.literal("slider"),
  description: z.string().max(800),
  params: z.array(SliderParam).min(1).max(4),
  outputs: z.array(SliderOutput).min(1).max(4),
  /** Optional line chart: sweep one param across its range, plot one output. */
  chart: z.object({ x: z.string(), outputIndex: z.number().int().min(0) }).optional(),
  insight: z.string().max(600),
});

export const StepperStep = z.object({
  from: id,
  to: id,
  label: z.string().min(1).max(80),
  detail: z.string().max(800),
  status: Status.default("neutral"),
  state: z.record(z.string(), z.string()).default({}),
});

export const StepperBlock = z.object({
  ...blockBase,
  type: z.literal("stepper"),
  description: z.string().max(800),
  lanes: z.array(z.object({ id, label: z.string().max(40) })).min(2).max(5),
  scenarios: z
    .array(z.object({ id, label: z.string().max(60), steps: z.array(StepperStep).min(1).max(14) }))
    .min(1)
    .max(3),
});

export const ArchNode = z.object({
  id,
  label: z.string().min(1).max(40),
  detail: z.string().max(1200),
  x: z.number(),
  y: z.number(),
});

export const ArchEdge = z.object({
  id,
  source: id,
  target: id,
  label: z.string().max(40).optional(),
  detail: z.string().max(1200).optional(),
  status: Status.default("neutral"),
});

export const ArchitectureBlock = z.object({
  ...blockBase,
  type: z.literal("architecture"),
  description: z.string().max(800),
  nodes: z.array(ArchNode).min(2).max(10),
  edges: z.array(ArchEdge).max(16),
  challenge: z
    .object({
      prompt: z.string().max(400),
      /** Edges hidden at start; the learner must draw them. */
      requiredEdges: z.array(z.object({ source: id, target: id })).min(1).max(6),
      successMessage: z.string().max(400),
    })
    .optional(),
});

export const CodeBlock = z.object({
  ...blockBase,
  type: z.literal("code"),
  language: z.string().max(20),
  code: z.string().min(1).max(3000),
  trace: z
    .array(
      z.object({
        line: z.number().int().min(1),
        vars: z.record(z.string(), z.string()).default({}),
        note: z.string().max(400),
        status: Status.default("neutral"),
      }),
    )
    .min(1)
    .max(30),
});

export const PredictBlock = z.object({
  ...blockBase,
  type: z.literal("predict"),
  question: z.string().max(400),
  options: z.array(z.string().max(200)).min(2).max(5),
  correctIndex: z.number().int().min(0),
  explanation: z.string().max(800),
});

export const LessonBlock = z.discriminatedUnion("type", [
  ConceptBlock,
  SliderBlock,
  StepperBlock,
  ArchitectureBlock,
  CodeBlock,
  PredictBlock,
]);
export type LessonBlock = z.infer<typeof LessonBlock>;
export type ConceptBlockT = z.infer<typeof ConceptBlock>;
export type SliderBlockT = z.infer<typeof SliderBlock>;
export type StepperBlockT = z.infer<typeof StepperBlock>;
export type ArchitectureBlockT = z.infer<typeof ArchitectureBlock>;
export type CodeBlockT = z.infer<typeof CodeBlock>;
export type PredictBlockT = z.infer<typeof PredictBlock>;

export const LessonDraft = z.object({
  title: shortText,
  summary: z.string().max(600),
  blocks: z.array(LessonBlock).min(3).max(14),
});
export type LessonDraft = z.infer<typeof LessonDraft>;

export const BLOCK_TYPES = ["concept", "slider", "stepper", "architecture", "code", "predict"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/**
 * What the browser receives: blocks + guardrail annotations.
 * "model" = no retrieved source covers it; written from the model's general
 * knowledge (only allowed when the topic's sources are thin).
 */
export type GuardedBlock = LessonBlock & {
  citations: Citation[];
  verification: { status: "verified" | "unverified" | "repaired" | "model"; issues: string[] };
};
export interface Lesson {
  topic: string;
  title: string;
  summary: string;
  level: Level;
  depth: LessonDepth;
  options: LessonOptions;
  grounding: Grounding;
  blocks: GuardedBlock[];
}

/* ---------- Agent 1: rubric (hidden ground truth for the Pupil) ---------- */

export const RubricItem = z.object({
  id,
  concept: shortText,
  expectation: z.string().max(500),
  keywords: z.array(z.string().max(40)).min(1).max(12),
  tier: Difficulty,
  blockId: z.string(),
});
export type RubricItem = z.infer<typeof RubricItem>;

export const Rubric = z.object({ items: z.array(RubricItem).min(3).max(8) });
export type Rubric = z.infer<typeof Rubric>;

export type RubricStatus = "pending" | "mastered" | "gap";

/* ---------- Agent 4: pupil ---------- */

export const TranscriptMsg = z.object({
  role: z.enum(["learner", "pupil"]),
  text: z.string().max(LIMITS.message),
  targetId: z.string().optional(),
});
export type TranscriptMsg = z.infer<typeof TranscriptMsg>;

export const PupilTurn = z.object({
  reply: z.string().min(1).max(800),
  targetId: z.string().optional(),
  updates: z
    .array(
      z.object({
        id,
        status: z.enum(["mastered", "gap"]),
        evidence: z.string().max(400),
      }),
    )
    .default([]),
});
export type PupilTurn = z.infer<typeof PupilTurn>;

export const Scorecard = z.object({
  score: z.number().min(0).max(100),
  summary: z.string().max(800),
  mastered: z.array(z.object({ id, concept: z.string(), evidence: z.string() })),
  gaps: z.array(z.object({ id, concept: z.string(), why: z.string(), blockId: z.string() })),
  nextSteps: z.array(z.string()).max(5),
});
export type Scorecard = z.infer<typeof Scorecard>;

/* ---------- Agent 5: fidelity + disputes ---------- */

export const FidelityReport = z.object({
  blocks: z.array(
    z.object({
      blockId: z.string(),
      supported: z.boolean(),
      issues: z.array(z.string()).max(5).default([]),
    }),
  ),
});

export const DisputeVerdict = z.object({
  verdict: z.enum(["upheld", "rejected"]),
  explanation: z.string().max(800),
  action: z.enum(["regenerate_block", "recalibrate_rubric", "none"]),
  rubricPatch: z
    .object({ id, expectation: z.string().max(500), keywords: z.array(z.string()).min(1).max(8) })
    .optional(),
  regradeTo: z.enum(["pending", "mastered", "gap"]).optional(),
});
export type DisputeVerdict = z.infer<typeof DisputeVerdict>;

export const NoteDraft = z.object({
  title: shortText,
  markdown: z.string().min(1).max(3000),
});
export type NoteDraft = z.infer<typeof NoteDraft>;

/* ---------- uploads ---------- */

export const ExtraDoc = z.object({
  name: z.string().max(200),
  text: z.string().max(LIMITS.uploadChars),
});
export type ExtraDoc = z.infer<typeof ExtraDoc>;
