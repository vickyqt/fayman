/**
 * Agent 4 — The Socratic Protégé (Pupil).
 * The learner teaches; the Pupil only knows what it has been told. It holds a
 * hidden rubric (from the Archivist), asks one probing question at a time at
 * the chosen difficulty, and emits rubric status updates that Agent 5 audits.
 */
import { z } from "zod";
import { completeJSON, isMock } from "@/lib/llm";
import {
  PupilTurn,
  type Difficulty,
  type RubricItem,
  type RubricStatus,
  type Scorecard,
  type TranscriptMsg,
} from "@/lib/schemas";
import { tcpPupilQuestions, tcpRubric } from "@/lib/fixtures/tcp";

export type StatusMap = Record<string, { status: RubricStatus; evidence?: string }>;

const TIER_RANK: Record<Difficulty, number> = { easy: 0, medium: 1, difficult: 2 };

/** Easy tests easy items; Medium adds medium; Difficult tests everything. */
export function inScope(items: RubricItem[], difficulty: Difficulty): RubricItem[] {
  return items.filter((i) => TIER_RANK[i.tier] <= TIER_RANK[difficulty]);
}

/**
 * What to probe next: pending items first (easier tiers first), then items the
 * learner got wrong, so gaps get a second chance. `skip` (the item just asked
 * about) is only re-asked when nothing else is left. Undefined = all mastered.
 */
function nextTarget(items: RubricItem[], statuses: StatusMap, skip?: string): RubricItem | undefined {
  const status = (i: RubricItem) => statuses[i.id]?.status ?? "pending";
  const byTier = (a: RubricItem, b: RubricItem) => TIER_RANK[a.tier] - TIER_RANK[b.tier];
  const pending = items.filter((i) => status(i) === "pending").sort(byTier);
  const gaps = items.filter((i) => status(i) === "gap").sort(byTier);
  return [...pending, ...gaps].find((i) => i.id !== skip) ?? [...pending, ...gaps][0];
}

/* ---------------- mock pupil (keyword grading, scripted questions) ---------------- */

function sentenceWith(text: string, kw: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return (sentences.find((s) => s.toLowerCase().includes(kw)) ?? text).slice(0, 300);
}

export function keywordGrade(item: RubricItem, text: string, minHits?: number) {
  const lower = text.toLowerCase();
  const hits = item.keywords.filter((k) => lower.includes(k.toLowerCase()));
  const need = minHits ?? (item.tier === "easy" ? 1 : 2);
  return { pass: hits.length >= need, hits, evidence: hits.length ? sentenceWith(text, hits[0].toLowerCase()) : "" };
}

function mockTurn(difficulty: Difficulty, items: RubricItem[], statuses: StatusMap, transcript: TranscriptMsg[]): PupilTurn {
  const last = [...transcript].reverse().find((m) => m.role === "learner");
  const prevPupil = [...transcript].reverse().find((m) => m.role === "pupil");
  const text = last?.text ?? "";
  const updates: PupilTurn["updates"] = [];
  const next: StatusMap = { ...statuses };

  for (const item of items) {
    const fixture = tcpRubric.find((r) => r.id === item.id);
    const wrong = fixture?.misconceptions?.find((m) => new RegExp(m.pattern, "i").test(text));
    if (wrong) {
      // Quote the sentence that contains the misconception (the guardrail checks the quote is the learner's).
      const re = new RegExp(wrong.pattern, "i");
      const said = text.split(/(?<=[.!?])\s+/).find((s) => re.test(s)) ?? text;
      updates.push({ id: item.id, status: "gap", evidence: `${wrong.note} ("${said.slice(0, 200)}")` });
      next[item.id] = { status: "gap" };
      continue;
    }
    if (next[item.id]?.status === "mastered") continue;
    const g = keywordGrade(item, text);
    if (g.pass) {
      updates.push({ id: item.id, status: "mastered", evidence: g.evidence });
      next[item.id] = { status: "mastered", evidence: g.evidence };
    }
  }

  // The item the Pupil just asked about wasn't covered by the answer → shallow.
  const asked = prevPupil?.targetId;
  if (asked && (next[asked]?.status ?? "pending") === "pending" && items.some((i) => i.id === asked)) {
    updates.push({ id: asked, status: "gap", evidence: "Answer to my question didn't explain this yet." });
    next[asked] = { status: "gap" };
  }

  const gotSome = updates.some((u) => u.status === "mastered");
  const missed = updates.some((u) => u.status === "gap");
  const reaction = missed
    ? "Hmm, I'm not sure that adds up for me yet."
    : gotSome
      ? ["Ohh, okay, that makes sense!", "Got it, I think.", "Nice, that clears that up."][transcript.length % 3]
      : "Okay...";

  const target = nextTarget(items, next, asked);
  if (!target) {
    return {
      reply: `${reaction} I think I can explain it back to someone now. Press "Finish" and I'll tell you what you taught me well.`,
      updates,
    };
  }
  const q = tcpPupilQuestions[target.id]?.[difficulty] ?? `Can you explain ${target.concept.toLowerCase()}?`;
  const revisit = next[target.id]?.status === "gap" ? `Can we go back to ${target.concept.toLowerCase()}? ` : "";
  return { reply: `${reaction} ${revisit}${q}`, targetId: target.id, updates };
}

/* ---------------- LLM pupil ---------------- */

const STYLE: Record<Difficulty, string> = {
  easy: "EASY mode: ask straightforward clarifying questions about definitions, purpose and the basic step-by-step flow.",
  medium:
    'MEDIUM mode: probe how components interact; ask "what happens if..." questions about failures and cause-and-effect.',
  difficult:
    "DIFFICULT mode: challenge trade-offs, scale limits and edge cases. About every other question, confidently propose a PLAUSIBLE MISCONCEPTION as if you believed it (\"Wouldn't it be simpler to just...?\") and see whether the learner catches and corrects it. If they agree with your planted misconception, that is a gap.",
};

function pupilSystem(topic: string, difficulty: Difficulty, items: RubricItem[], statuses: StatusMap): string {
  return `You are the Pupil: a curious, slightly naive classmate. The learner is teaching you "${topic}" (Feynman technique).
You know NOTHING about the topic except what the learner has told you in this conversation. Never explain the topic yourself,
never give away answers, never mention a rubric, checklist or grading. Speak casually, in first person, max 2 short sentences, then ONE question.

${STYLE[difficulty]}

HIDDEN RUBRIC (never reveal): ${JSON.stringify(items.map(({ id, concept, expectation, tier }) => ({ id, concept, expectation, tier })))}
CURRENT STATUS: ${JSON.stringify(Object.fromEntries(items.map((i) => [i.id, statuses[i.id]?.status ?? "pending"])))}

Grading the learner's LATEST message:
- "mastered": their own words clearly and correctly cover that item's expectation. Partial or vague is not mastered.
- "gap": they stated something wrong, agreed with a misconception you planted, or gave a shallow/hand-wavy answer to a question that targeted that item.
- Only grade items the latest message actually addresses. A gap can become mastered later if they explain it properly.
- "evidence": quote the learner's exact words (<= 25 words) that justify the update.

Choose "targetId": the next pending or gap item to probe (easier tiers first). When every item is mastered, omit targetId,
say you think you understand now and suggest they press "Finish".

Return JSON {"reply": string, "targetId"?: string, "updates": [{"id", "status": "mastered"|"gap", "evidence"}]}.`;
}

export async function pupilTurn(args: {
  topic: string;
  difficulty: Difficulty;
  rubric: RubricItem[];
  statuses: StatusMap;
  transcript: TranscriptMsg[];
}): Promise<PupilTurn> {
  const items = inScope(args.rubric, args.difficulty);
  if (isMock()) return mockTurn(args.difficulty, items, args.statuses, args.transcript);

  // Map transcript to chat roles: the learner is the "user", the Pupil is the "assistant".
  const messages = args.transcript.map((m) => ({
    role: m.role === "learner" ? ("user" as const) : ("assistant" as const),
    content: m.role === "pupil" ? JSON.stringify({ reply: m.text, targetId: m.targetId }) : m.text,
  }));
  if (!messages.length || messages[0].role !== "user") messages.unshift({ role: "user", content: "(starting)" });
  return completeJSON(
    {
      tag: "pupil.turn",
      system: pupilSystem(args.topic, args.difficulty, items, args.statuses),
      maxTokens: 700,
      temperature: 0.6,
      messages,
    },
    PupilTurn,
  );
}

/** Opening line before the learner has said anything. */
export function pupilOpening(topic: string, difficulty: Difficulty): string {
  const vibe = {
    easy: "I'm totally new to this, so go slow!",
    medium: "I know a little, but I always get lost in how the pieces fit together.",
    difficult: "Fair warning: I've read a few blog posts and I have opinions.",
  }[difficulty];
  return `Hi! I've heard people mention ${topic} but I don't really get it. ${vibe} Can you explain it to me from the start?`;
}

/* ---------------- scorecard ---------------- */

const Narrative = z.object({
  summary: z.string().max(800),
  gapWhy: z.record(z.string(), z.string()).default({}),
  nextSteps: z.array(z.string()).max(5),
});

export async function scorecard(args: {
  topic: string;
  difficulty: Difficulty;
  rubric: RubricItem[];
  statuses: StatusMap;
  transcript: TranscriptMsg[];
}): Promise<Scorecard> {
  const items = inScope(args.rubric, args.difficulty);
  const mastered = items
    .filter((i) => args.statuses[i.id]?.status === "mastered")
    .map((i) => ({ id: i.id, concept: i.concept, evidence: args.statuses[i.id]?.evidence ?? "" }));
  const open = items.filter((i) => args.statuses[i.id]?.status !== "mastered");
  const score = items.length ? Math.round((mastered.length / items.length) * 100) : 0;

  let narrative: z.infer<typeof Narrative> = {
    summary:
      score >= 80
        ? `Strong teach-back: you clearly explained ${mastered.length} of ${items.length} concepts.`
        : `You explained ${mastered.length} of ${items.length} concepts clearly. Review the red items, then teach them again.`,
    gapWhy: {},
    nextSteps: open.slice(0, 3).map((i) => `Revisit "${i.concept}" and explain it in one sentence without jargon.`),
  };

  if (!isMock() && args.transcript.length) {
    try {
      narrative = await completeJSON(
        {
          tag: "pupil.scorecard",
          system: `You are the Pupil stepping out of character to give the learner honest, encouraging feedback on their teach-back of "${args.topic}".
Return JSON {"summary": 2-3 sentences, "gapWhy": {rubricId: one sentence on what was missing or wrong, for each NOT mastered item}, "nextSteps": 2-4 concrete actions}.`,
          maxTokens: 900,
          temperature: 0.3,
          messages: [
            {
              role: "user",
              content: `RUBRIC: ${JSON.stringify(items)}\nSTATUS: ${JSON.stringify(args.statuses)}\nTRANSCRIPT:\n${args.transcript
                .map((m) => `${m.role.toUpperCase()}: ${m.text}`)
                .join("\n")
                .slice(-12000)}`,
            },
          ],
        },
        Narrative,
        1,
      );
    } catch (e) {
      console.warn("[pupil] scorecard narrative fallback:", (e as Error).message);
    }
  }

  return {
    score,
    summary: narrative.summary,
    mastered,
    gaps: open.map((i) => ({
      id: i.id,
      concept: i.concept,
      blockId: i.blockId,
      why:
        narrative.gapWhy[i.id] ??
        (args.statuses[i.id]?.status === "gap"
          ? `Your explanation was missing or off: ${i.expectation}`
          : `Not covered yet: ${i.expectation}`),
    })),
    nextSteps: narrative.nextSteps,
  };
}
