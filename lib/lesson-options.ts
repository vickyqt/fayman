/**
 * What the learner's lesson options mean, in one place. The diagnostic panel
 * renders these labels; Agent 3 turns the same numbers into prompt rules, and
 * the mock lesson trims the fixture with them. Shared by server and client.
 */
import type { Interactivity, LessonDepth, LessonLength, LessonOptions, Level } from "@/lib/schemas";

export const DEFAULT_OPTIONS: LessonOptions = { length: "standard", depth: "auto", interactivity: "balanced" };

export const LENGTHS: Record<LessonLength, { label: string; hint: string; min: number; max: number; words: number; maxTokens: number }> = {
  short: { label: "Quick", hint: "4–5 sections · ~5 min", min: 4, max: 5, words: 80, maxTokens: 6000 },
  standard: { label: "Standard", hint: "6–8 sections · ~10 min", min: 6, max: 8, words: 120, maxTokens: 9000 },
  deep: { label: "Deep dive", hint: "9–12 sections · ~20 min", min: 9, max: 12, words: 170, maxTokens: 14000 },
};

export const DEPTHS: Record<LessonDepth, { label: string; hint: string; level: Level }> = {
  foundations: { label: "Foundations", hint: "Analogies, purpose, step by step", level: "beginner" },
  mechanisms: { label: "Mechanisms", hint: "How the parts interact, failure cases", level: "intermediate" },
  "edge-cases": { label: "Edge cases", hint: "Trade-offs, scale limits, internals", level: "advanced" },
};

/** `share` = target fraction of blocks that are interactive widgets. */
export const INTERACTIVITY: Record<Interactivity, { label: string; hint: string; share: number; bars: number }> = {
  light: { label: "Light", hint: "Mostly reading, a few widgets", share: 0.35, bars: 1 },
  balanced: { label: "Balanced", hint: "About half hands-on", share: 0.55, bars: 2 },
  rich: { label: "Hands-on", hint: "Mostly widgets", share: 0.75, bars: 3 },
  max: { label: "All in", hint: "Every section interactive", share: 1, bars: 4 },
};

export function withDefaults(o?: Partial<LessonOptions> | null): LessonOptions {
  return { ...DEFAULT_OPTIONS, ...(o ?? {}) };
}

/** Depth actually used: the learner's override, or what the diagnostic inferred. */
export function effectiveDepth(o: LessonOptions, inferred: LessonDepth): LessonDepth {
  return o.depth === "auto" ? inferred : o.depth;
}

/** Rough block budget for a length + interactivity choice (used in prompts and UI previews). */
export function budget(o: LessonOptions) {
  const len = LENGTHS[o.length];
  const target = Math.round((len.min + len.max) / 2);
  const share = INTERACTIVITY[o.interactivity].share;
  const interactive = o.interactivity === "max" ? target : Math.max(1, Math.round(target * share));
  return { min: len.min, max: len.max, target, interactive, concepts: Math.max(0, target - interactive) };
}

/* ---------- diagnostic scoring (shared so the UI can preview "Auto" depth) ---------- */

/** Deeper questions weigh more: knowing implementation details implies more. */
export const DEPTH_WEIGHT = { "mental-model": 1, mechanism: 1.25, implementation: 1.5 } as const;

export function levelFromScore(score: number): { level: Level; depth: LessonDepth } {
  if (score < 0.45) return { level: "beginner", depth: "foundations" };
  if (score < 0.8) return { level: "intermediate", depth: "mechanisms" };
  return { level: "advanced", depth: "edge-cases" };
}

/** Weighted diagnostic score in [0, 1]; unanswered / "not sure" counts as wrong. */
export function diagnosticScore(
  questions: { id: string; depth: keyof typeof DEPTH_WEIGHT; correctIndex: number }[],
  choices: Record<string, number | undefined>,
): number {
  const total = questions.reduce((s, q) => s + DEPTH_WEIGHT[q.depth], 0);
  const got = questions.reduce((s, q) => s + (choices[q.id] === q.correctIndex ? DEPTH_WEIGHT[q.depth] : 0), 0);
  return total ? got / total : 0;
}

export function describeOptions(o: LessonOptions): string {
  const b = budget(o);
  const depth = o.depth === "auto" ? "depth from your answers" : `${DEPTHS[o.depth].label.toLowerCase()} depth`;
  return `≈${b.target} sections · ${o.interactivity === "max" ? "all" : `~${b.interactive}`} interactive · ${depth}`;
}
