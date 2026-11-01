/**
 * Agent 2 — The Diagnostic Assessor.
 * Asks 3-4 calibration questions, then produces a LearnerProfile that tells the
 * Teacher how deep to go. Scoring is deterministic; the LLM only interprets
 * free-text explanations into known concepts / gaps / misconceptions.
 */
import { z } from "zod";
import { completeJSON, isMock } from "@/lib/llm";
import type { Chunk } from "@/lib/retrieval";
import {
  DiagnosticSet,
  type DiagnosticAnswer,
  type DiagnosticQuestion,
  type Grounding,
  type LearnerProfile,
} from "@/lib/schemas";
import { tcpDiagnostic } from "@/lib/fixtures/tcp";
import { diagnosticScore, levelFromScore } from "@/lib/lesson-options";
import { formatContext, groundingRules } from "./archivist";

const QUESTION_SYSTEM = `You are the Diagnostic Assessor agent. Before a lesson is generated, you calibrate what the learner already knows.
Write 4 multiple-choice questions about the topic, ordered from high-level mental model to low-level implementation:
1 "mental-model" question, 2 "mechanism" questions, 1 "implementation" question.
Each has 4 options with exactly one correct answer; distractors must be plausible misconceptions, not jokes.
Return JSON {"questions": [{"id": "d1".."d4", "prompt", "depth", "concept" (<= 6 words), "options": string[4], "correctIndex"}]}.
Vary which option position is correct.`;

export async function generateQuestions(
  topic: string,
  chunks: Chunk[],
  grounding: Grounding = "sources",
): Promise<DiagnosticQuestion[]> {
  if (isMock()) return tcpDiagnostic;
  const out = await completeJSON(
    {
      tag: "diagnostic.questions",
      system: `${QUESTION_SYSTEM}\n${groundingRules(grounding)}`,
      maxTokens: 1800,
      temperature: 0.3,
      messages: [{ role: "user", content: `TOPIC: ${topic}\n\nSOURCES:\n${formatContext(chunks)}` }],
    },
    DiagnosticSet,
  );
  // Answers are keyed by question id, so ids must be unique: renumber them d1..dn.
  return out.questions.map((q, i) => ({ ...q, id: `d${i + 1}`, correctIndex: Math.min(q.correctIndex, q.options.length - 1) }));
}

function grade(questions: DiagnosticQuestion[], answers: DiagnosticAnswer[]) {
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const rows = questions.map((q) => {
    const a = byId.get(q.id);
    // Anything outside the option list counts as "I'm not sure".
    const choice = a && a.choice >= 0 && a.choice < q.options.length ? a.choice : -1;
    return {
      q,
      choice,
      correct: choice === q.correctIndex,
      unsure: choice < 0,
      explanation: a?.explanation ?? "",
    };
  });
  // Deeper questions weigh more (shared with the UI's "Auto depth" preview).
  const score = diagnosticScore(questions, Object.fromEntries(rows.map((r) => [r.q.id, r.choice])));
  const { level, depth } = levelFromScore(score);
  return { rows, score, level, depth };
}

const Interpretation = z.object({
  known: z.array(z.string()).max(8),
  gaps: z.array(z.string()).max(8),
  misconceptions: z.array(z.string()).max(6),
  summary: z.string().max(600),
});

const PROFILE_SYSTEM = `You are the Diagnostic Assessor agent. Interpret a learner's diagnostic answers.
For each wrong answer, the option they chose often reveals a specific misconception; name it concretely
(e.g. "thinks the ACK number echoes the SYN's sequence number"). Use their free-text explanations when present.
Return JSON {"known": string[], "gaps": string[], "misconceptions": string[], "summary": string (2 sentences, addressed to the teacher, saying what to emphasise)}.`;

export async function evaluate(
  topic: string,
  questions: DiagnosticQuestion[],
  answers: DiagnosticAnswer[],
): Promise<LearnerProfile> {
  const g = grade(questions, answers);
  const base = {
    level: g.level,
    score: Math.round(g.score * 100) / 100,
    depth: g.depth,
    known: g.rows.filter((r) => r.correct).map((r) => r.q.concept),
    gaps: g.rows.filter((r) => !r.correct).map((r) => r.q.concept),
  };

  if (isMock()) {
    return {
      ...base,
      misconceptions: g.rows
        .filter((r) => !r.correct && !r.unsure)
        .map((r) => `On "${r.q.concept}" chose: "${r.q.options[r.choice]}"`),
      summary:
        g.level === "beginner"
          ? "Start from the purpose of sequence numbers with analogies; step through the handshake slowly."
          : g.level === "intermediate"
            ? "Learner knows the flow; focus on why three segments, ACK arithmetic and loss handling."
            : "Learner has the fundamentals; skip basics and go to SYN floods, latency trade-offs and edge cases.",
    };
  }

  const table = g.rows
    .map(
      (r, i) =>
        `Q${i + 1} [${r.q.depth}] ${r.q.prompt}\n  correct: ${r.q.options[r.q.correctIndex]}\n  learner: ${
          r.unsure ? "I'm not sure" : r.q.options[r.choice]
        } (${r.correct ? "RIGHT" : "WRONG"})${r.explanation ? `\n  learner explanation: ${r.explanation}` : ""}`,
    )
    .join("\n");
  try {
    const it = await completeJSON(
      {
        tag: "diagnostic.profile",
        system: PROFILE_SYSTEM,
        maxTokens: 800,
        temperature: 0.2,
        messages: [{ role: "user", content: `TOPIC: ${topic}\nSCORE: ${base.score} (${base.level})\n\n${table}` }],
      },
      Interpretation,
      1,
    );
    return { ...base, ...it, known: it.known.length ? it.known : base.known, gaps: it.gaps.length ? it.gaps : base.gaps };
  } catch (e) {
    console.warn("[diagnostic] interpretation fallback:", (e as Error).message);
    return { ...base, misconceptions: [], summary: `Learner scored ${base.score} on the diagnostic (${base.level}).` };
  }
}
