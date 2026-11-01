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

const topic = z.string().trim().min(2).max(120);
const extraDocs = z.array(ExtraDoc).max(10).default([]);
const statuses = z
  .record(z.string(), z.object({ status: z.enum(["pending", "mastered", "gap"]), evidence: z.string().optional() }))
  .default({});

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
    instruction: z.string().trim().max(1200).default(""),
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
  transcript: z.array(TranscriptMsg).max(80),
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
  complaint: z.string().trim().min(3).max(1000),
  block: LessonBlock.optional(),
  rubricItem: RubricItem.optional(),
  currentStatus: z.object({ status: z.enum(["pending", "mastered", "gap"]), evidence: z.string().optional() }).optional(),
  transcript: z.array(TranscriptMsg).max(80).optional(),
  extraDocs,
});
