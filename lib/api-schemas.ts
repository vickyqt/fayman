/** Request bodies for the API routes. */
import { z } from "zod";
import {
  BLOCK_TYPES,
  DiagnosticAnswer,
  DiagnosticQuestion,
  Difficulty,
  ExtraDoc,
  LearnerProfile,
  LessonBlock,
  LessonOptions,
  RubricItem,
  TranscriptMsg,
} from "@/lib/schemas";
import { LIMITS } from "@/lib/limits";

const topic = z.string().trim().min(2).max(LIMITS.topic);
const extraDocs = z.array(ExtraDoc).max(LIMITS.uploads).default([]);
const statuses = z
  .record(z.string(), z.object({ status: z.enum(["pending", "mastered", "gap"]), evidence: z.string().optional() }))
  .default({});
/**
 * Long teach-backs are fine: the client sends the recent window, and anything
 * older than LIMITS.transcript messages is dropped here rather than rejected.
 * Rubric statuses carry the earlier progress.
 */
const transcript = z
  .array(TranscriptMsg)
  .max(LIMITS.transcript * 5)
  .transform((t) => t.slice(-LIMITS.transcript));

export const DiagnosticReq = z.object({ topic, extraDocs });

export const LessonReq = z.object({
  topic,
  questions: z.array(DiagnosticQuestion).min(1).max(6),
  answers: z.array(DiagnosticAnswer).max(6),
  options: LessonOptions.optional(),
  extraDocs,
});

export const ReimagineReq = z
  .object({
    topic,
    scope: z.enum(["block", "lesson"]),
    /** What the learner imagined. Optional for a whole-lesson rebuild that only changes options. */
    instruction: z.string().trim().max(LIMITS.instruction).default(""),
    block: LessonBlock.optional(),
    preferType: z.enum(BLOCK_TYPES).optional(),
    outline: z.array(z.object({ id: z.string().max(64), type: z.string().max(20), title: z.string().max(200) })).max(16).default([]),
    profile: LearnerProfile,
    options: LessonOptions.optional(),
    extraDocs,
  })
  .refine((r) => r.scope === "lesson" || (r.block && r.instruction.length >= 3), {
    message: "Reimagining a section needs the block and a description (3+ characters)",
  });

export const PupilReq = z.object({
  topic,
  difficulty: Difficulty,
  rubric: z.array(RubricItem).min(1).max(10),
  statuses,
  transcript,
});

export const NoteReq = z.object({
  topic,
  block: LessonBlock,
  state: z.record(z.string(), z.unknown()).optional(),
  focus: z.object({ title: z.string().max(200), detail: z.string().max(2000) }).optional(),
});

export const DisputeReq = z.object({
  topic,
  kind: z.enum(["block", "grading"]),
  complaint: z.string().trim().min(3).max(LIMITS.complaint),
  block: LessonBlock.optional(),
  rubricItem: RubricItem.optional(),
  currentStatus: z.object({ status: z.enum(["pending", "mastered", "gap"]), evidence: z.string().optional() }).optional(),
  transcript: transcript.optional(),
  extraDocs,
});
