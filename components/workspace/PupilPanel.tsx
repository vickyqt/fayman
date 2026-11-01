"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { canListen, listen, speak, stopSpeaking, type Dictation } from "@/lib/client/speech";
import type { Session } from "@/lib/client/store";
import { LIMITS } from "@/lib/limits";
import type { Difficulty, PupilTurn, RubricItem, RubricStatus, Scorecard, TranscriptMsg } from "@/lib/schemas";

type Teach = NonNullable<Session["teach"]>;

const TIERS: { id: Difficulty; label: string; blurb: string }[] = [
  { id: "easy", label: "Easy", blurb: "Foundational recall: definitions, purpose, basic flow." },
  { id: "medium", label: "Medium", blurb: "Mechanism & cause-effect: “what happens if…”" },
  { id: "difficult", label: "Difficult", blurb: "Edge cases & trade-offs. The Pupil plants misconceptions; catch them." },
];
const RANK = { easy: 0, medium: 1, difficult: 2 };

export function PupilPanel({
  session,
  onChange,
  onReview,
  onDispute,
  onScore,
}: {
  session: Session;
  onChange: (t: Teach | undefined) => void;
  onReview: (blockId: string) => void;
  onDispute: (item: RubricItem) => void;
  onScore: (s: Scorecard, d: Difficulty) => void;
}) {
  const teach = session.teach;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [voiceOut, setVoiceOut] = useState(false);
  const [mic, setMic] = useState(false);
  const dictation = useRef<Dictation | null>(null);
  const [listenable, setListenable] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // scrollIntoView may return a Promise in newer browsers; never return it from an effect.
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [teach?.transcript.length]);
  useEffect(() => {
    setListenable(canListen()); // client-only check, avoids a hydration mismatch
    return () => {
      dictation.current?.abort();
      stopSpeaking();
    };
  }, []);

  const say = (text: string) => voiceOut && speak(text, { persona: "pupil", owner: "pupil" });

  const scope = teach ? session.rubric.filter((r) => RANK[r.tier] <= RANK[teach.difficulty]) : [];
  const body = (t: Teach) => ({
    topic: session.lesson.topic,
    difficulty: t.difficulty,
    rubric: session.rubric,
    statuses: t.statuses,
    // Long conversations keep working: the Pupil sees the recent window, and the
    // statuses carry everything already graded.
    transcript: t.transcript.slice(-LIMITS.transcript),
  });

  async function start(difficulty: Difficulty) {
    const t: Teach = { difficulty, transcript: [], statuses: {} };
    setBusy(true);
    setErr("");
    try {
      const turn = await api<PupilTurn>("pupil", body(t));
      const next = { ...t, transcript: [{ role: "pupil" as const, text: turn.reply }] };
      onChange(next);
      say(turn.reply);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!teach || !input.trim()) return;
    // Abort (not stop): a late recognition result must not refill the box after sending.
    dictation.current?.abort();
    dictation.current = null;
    setMic(false);
    const transcript: TranscriptMsg[] = [...teach.transcript, { role: "learner", text: input.trim() }];
    const optimistic = { ...teach, transcript };
    onChange(optimistic);
    setInput("");
    setBusy(true);
    setErr("");
    try {
      const turn = await api<PupilTurn>("pupil", body(optimistic));
      const statuses = { ...teach.statuses };
      for (const u of turn.updates) statuses[u.id] = { status: u.status, evidence: u.evidence };
      onChange({
        ...optimistic,
        statuses,
        transcript: [...transcript, { role: "pupil", text: turn.reply, targetId: turn.targetId }],
      });
      say(turn.reply);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!teach) return;
    setBusy(true);
    try {
      const sc = await api<Scorecard>("scorecard", body(teach));
      onChange({ ...teach, scorecard: sc });
      onScore(sc, teach.difficulty);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    if (mic) {
      dictation.current?.stop(); // keep words still being recognised
      return;
    }
    stopSpeaking(); // don't transcribe the Pupil's own voice
    setErr("");
    const base = input.trim() ? input.trim() + " " : "";
    setMic(true);
    dictation.current = listen(
      (text) => setInput((base + text).slice(0, LIMITS.message)),
      (e) => {
        setMic(false);
        dictation.current = null;
        if (e) setErr(e);
      },
    );
  }

  /* ---------- difficulty picker ---------- */
  if (!teach) {
    return (
      <div className="canvas">
        <div className="canvas-inner">
          <div>
            <span className="tag blue">Agent 4 · The Pupil</span>
            <h1 style={{ marginTop: 12 }}>Now you teach it.</h1>
            <p>
              The Pupil knows nothing except what you tell it. Explain <strong>{session.lesson.topic}</strong> in your own words, by
              typing or talking, and it will ask follow-up questions. A hidden rubric turns green as you explain each concept clearly,
              and red where something is missing or wrong.
            </p>
          </div>
          <div className="stack">
            {TIERS.map((t) => (
              <button key={t.id} className="opt" style={{ padding: 16 }} disabled={busy} onClick={() => start(t.id)}>
                <span className="letter" style={{ minWidth: 92 }}>
                  {t.label}
                </span>
                <span>
                  {t.blurb}{" "}
                  <span className="muted small">({session.rubric.filter((r) => RANK[r.tier] <= RANK[t.id]).length} concepts)</span>
                </span>
              </button>
            ))}
          </div>
          <label className="small row" style={{ gap: 6 }}>
            <input type="checkbox" checked={voiceOut} onChange={(e) => setVoiceOut(e.target.checked)} /> Let the Pupil talk (text-to-speech)
          </label>
          {err && <div className="warn">{err}</div>}
        </div>
      </div>
    );
  }

  const st = (id: string): RubricStatus => teach.statuses[id]?.status ?? "pending";
  const counts = { mastered: scope.filter((r) => st(r.id) === "mastered").length, gap: scope.filter((r) => st(r.id) === "gap").length };

  /* ---------- scorecard ---------- */
  if (teach.scorecard) {
    const sc = teach.scorecard;
    return (
      <div className="canvas">
        <div className="canvas-inner">
          <span className="tag blue">Teach-back scorecard · {teach.difficulty}</span>
          <div className="card row" style={{ gap: 24 }}>
            <div className="score" style={{ color: sc.score >= 70 ? "var(--green)" : sc.score >= 40 ? "var(--black)" : "var(--red)" }}>
              {sc.score}%
            </div>
            <p style={{ flex: 1, margin: 0 }}>{sc.summary}</p>
          </div>
          {sc.mastered.length > 0 && (
            <section className="block">
              <header className="block-head">
                <span className="tag green">Mastered</span>
                <h2>You taught these clearly</h2>
              </header>
              <ul className="rubric" style={{ margin: 0, padding: 0, border: 0, boxShadow: "none" }}>
                {sc.mastered.map((m) => (
                  <li key={m.id}>
                    <span className="dot mastered" />
                    <div>
                      <strong>{m.concept}</strong>
                      {m.evidence && <div className="small muted">“{m.evidence}”</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {sc.gaps.length > 0 && (
            <section className="block">
              <header className="block-head">
                <span className="tag red">Review</span>
                <h2>Gaps, linked to the lesson</h2>
              </header>
              <ul className="rubric" style={{ margin: 0, padding: 0, border: 0, boxShadow: "none" }}>
                {sc.gaps.map((g) => (
                  <li key={g.id}>
                    <span className="dot gap" />
                    <div style={{ flex: 1 }}>
                      <strong>{g.concept}</strong>
                      <div className="small">{g.why}</div>
                    </div>
                    <button className="btn sm primary" onClick={() => onReview(g.blockId)}>
                      Review block →
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {sc.nextSteps.length > 0 && (
            <div className="insight">
              <strong>Next steps</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                {sc.nextSteps.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="row">
            <button className="btn primary" onClick={() => onChange(undefined)}>
              Teach again
            </button>
            <button className="btn" onClick={() => onChange({ ...teach, scorecard: undefined })}>
              Back to conversation
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- conversation ---------- */
  return (
    <div className="canvas">
      <div className="teach">
        <div className="chat">
          <div className="block-head">
            <span className="tag blue">Pupil · {teach.difficulty}</span>
            <span className="spacer" />
            <label className="small row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={voiceOut}
                onChange={(e) => {
                  setVoiceOut(e.target.checked);
                  if (!e.target.checked) stopSpeaking();
                }}
              />{" "}
              Voice
            </label>
            <button className="btn ghost sm" onClick={() => onChange(undefined)}>
              Restart
            </button>
          </div>
          <div className="msgs" aria-live="polite">
            {teach.transcript.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <span className="who">{m.role === "pupil" ? "Pupil" : "You"}</span>
                {m.text}
              </div>
            ))}
            {busy && (
              <div className="msg pupil">
                <span className="who">Pupil</span>…thinking
              </div>
            )}
            <div ref={end} />
          </div>
          <div className="composer">
            {err && <div className="warn small">{err}</div>}
            <textarea
              className="textarea"
              placeholder={teach.transcript.length <= 1 ? "Explain it like you're talking to a friend…" : "Answer the Pupil…"}
              value={input}
              maxLength={LIMITS.message}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
            />
            <div className="row">
              {listenable && (
                <button className={`btn sm mic ${mic ? "on" : ""}`} onClick={toggleMic} aria-pressed={mic}>
                  {mic ? "● Listening… (stop)" : "🎙 Speak"}
                </button>
              )}
              <span className="small muted">⌘/Ctrl + Enter to send</span>
              <span className="spacer" />
              <button className="btn" onClick={finish} disabled={busy || teach.transcript.length < 3}>
                Finish
              </button>
              <button className="btn primary" onClick={send} disabled={busy || !input.trim()}>
                Send
              </button>
            </div>
          </div>
        </div>

        <aside className="rubric" aria-label="Concept rubric">
          <div className="block-head">
            <strong>Concept checklist</strong>
            <span className="spacer" />
            <span className="tag green">{counts.mastered}</span>
            <span className="tag red">{counts.gap}</span>
          </div>
          <ul style={{ margin: 0, padding: 0 }}>
            {scope.map((r) => {
              const s = st(r.id);
              return (
                <li key={r.id}>
                  <span className={`dot ${s}`} title={s} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{r.concept}</div>
                    <div className="small muted">
                      {s === "pending" ? "Not explained yet" : s === "mastered" ? "Explained clearly" : "Missing or off"}
                    </div>
                    {s === "gap" && (
                      <div className="row" style={{ gap: 4, marginTop: 4 }}>
                        <button className="btn ghost sm" onClick={() => onReview(r.blockId)}>
                          Review
                        </button>
                        <button className="btn ghost sm" onClick={() => onDispute(r)}>
                          Unfair?
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="small muted" style={{ padding: "10px 12px" }}>
            Blue = pending · Green = explained · Red = gap. Concept names show what to cover, not the answer.
          </div>
        </aside>
      </div>
    </div>
  );
}
