"use client";
import { useEffect, useState } from "react";
import { DEPTHS, diagnosticScore, levelFromScore } from "@/lib/lesson-options";
import { getPrefs, setPrefs } from "@/lib/client/store";
import { LIMITS } from "@/lib/limits";
import type { DiagnosticAnswer, DiagnosticQuestion, LessonOptions } from "@/lib/schemas";
import { LessonOptionsPicker } from "./LessonOptionsPicker";

const DEPTH_LABEL = { "mental-model": "Mental model", mechanism: "Mechanism", implementation: "Implementation" };

export function DiagnosticPanel({
  topic,
  questions,
  sources,
  weakSources,
  notice,
  initial,
  onSubmit,
}: {
  topic: string;
  questions: DiagnosticQuestion[];
  sources: { id: string; label: string; url: string; origin?: string }[];
  weakSources: boolean;
  notice?: string;
  /** Previous answers and options, e.g. when returning after a failed lesson build. */
  initial?: { answers: DiagnosticAnswer[]; options: LessonOptions };
  onSubmit: (answers: DiagnosticAnswer[], options: LessonOptions) => void;
}) {
  const [choice, setChoice] = useState<Record<string, number>>(() =>
    Object.fromEntries((initial?.answers ?? []).map((a) => [a.questionId, a.choice])),
  );
  const [why, setWhy] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.answers ?? []).filter((a) => a.explanation).map((a) => [a.questionId, a.explanation])),
  );
  const [options, setOptions] = useState<LessonOptions | null>(initial?.options ?? null);
  useEffect(() => {
    if (!initial) setOptions(getPrefs()); // client-only: localStorage
  }, [initial]);

  const answered = Object.keys(choice).length;
  const done = questions.every((q) => choice[q.id] !== undefined);
  const predicted = levelFromScore(diagnosticScore(questions, choice)).depth;
  const autoHint = answered ? `${DEPTHS[predicted].label}, from your answers` : "Matched to your answers";
  const webCount = sources.filter((s) => s.origin === "web").length;

  return (
    <div className="canvas">
      <div className="canvas-inner">
        <div>
          <span className="tag blue">Agent 2 · Diagnostic assessor</span>
          <h1 style={{ marginTop: 12 }}>Before we build your lesson…</h1>
          <p className="muted">
            {questions.length} quick questions on <strong>{topic}</strong>, from big picture to low-level detail. Guess honestly or
            pick “I’m not sure”. Then choose how long, how deep and how hands-on your lesson should be.
          </p>
          {notice && <div className="warn">{notice}</div>}
          {weakSources && !notice && (
            <div className="insight" style={{ marginTop: 0 }}>
              <strong>Few sources found for this topic.</strong> The Teacher will use its general knowledge where sources run out, and
              those sections are labelled <span className="tag">◇ model knowledge</span>. For stronger grounding, upload your notes on the
              home page or add repos to <code>config/trusted-repos.json</code>.
            </div>
          )}
        </div>

        {questions.map((q, qi) => (
          <section className="block" key={q.id}>
            <header className="block-head">
              <span className="tag">Q{qi + 1}</span>
              <span className="tag blue">{DEPTH_LABEL[q.depth]}</span>
              <h2 style={{ fontSize: "1.05rem" }}>{q.prompt}</h2>
            </header>
            <div className="block-body stack">
              {[...q.options, "I’m not sure"].map((o, i) => {
                const val = i === q.options.length ? -1 : i;
                const picked = choice[q.id] === val;
                return (
                  <button
                    key={i}
                    className="opt"
                    aria-pressed={picked}
                    style={picked ? { borderColor: "var(--blue)", background: "var(--blue-tint)", boxShadow: "inset 4px 0 0 var(--blue)" } : undefined}
                    onClick={() => setChoice((c) => ({ ...c, [q.id]: val }))}
                  >
                    <span className="letter">{val === -1 ? "?" : String.fromCharCode(65 + i)}</span>
                    <span>{o}</span>
                  </button>
                );
              })}
              <input
                className="input"
                placeholder="Optional: why? (one line helps the assessor spot misconceptions)"
                value={why[q.id] ?? ""}
                maxLength={LIMITS.diagnosticWhy}
                onChange={(e) => setWhy((w) => ({ ...w, [q.id]: e.target.value }))}
              />
            </div>
          </section>
        ))}

        <section className="block shape" aria-labelledby="shape-h">
          <header className="block-head">
            <span className="tag blue">Your lesson</span>
            <h2 id="shape-h" style={{ fontSize: "1.05rem" }}>
              Shape what gets generated
            </h2>
          </header>
          <div className="block-body">
            {options && <LessonOptionsPicker value={options} onChange={(p) => setOptions((o) => (o ? { ...o, ...p } : o))} autoHint={autoHint} />}
          </div>
        </section>

        <div className="row">
          <button
            className="btn primary"
            disabled={!done || !options}
            onClick={() => {
              if (!options) return;
              setPrefs(options);
              onSubmit(
                questions.map((q) => ({ questionId: q.id, choice: choice[q.id] ?? -1, explanation: why[q.id] ?? "" })),
                options,
              );
            }}
          >
            Build my lesson →
          </button>
          <span className="small muted">
            {answered}/{questions.length} answered
          </span>
          <span className="spacer" />
          {sources.length > 0 && (
            <span className="small muted">
              Grounded in {sources.length} source sections{webCount ? ` (${webCount} from the web)` : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
