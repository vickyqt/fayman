"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { stopSpeaking } from "@/lib/client/speech";
import {
  clearSession,
  download,
  folderToMarkdown,
  getFolder,
  getSession,
  getUploads,
  saveFolder,
  saveSession,
  type Folder,
  type Session,
} from "@/lib/client/store";
import type {
  DiagnosticAnswer,
  DiagnosticQuestion,
  GuardedBlock,
  Lesson,
  LearnerProfile,
  LessonBlock,
  LessonOptions,
  NoteDraft,
  RubricItem,
} from "@/lib/schemas";
import { DEPTHS, describeOptions } from "@/lib/lesson-options";
import { LIMITS } from "@/lib/limits";
import { BlockFrame } from "@/components/blocks/BlockFrame";
import type { Focus } from "@/components/blocks/types";
import { Sparkle } from "@/components/Sparkle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DiagnosticPanel } from "./DiagnosticPanel";
import { NotesDrawer, type Draft } from "./NotesDrawer";
import { PupilPanel } from "./PupilPanel";
import { ReimagineDialog, type ReimagineRequest, type ReimagineTarget } from "./ReimagineDialog";

const MAX_REVISIONS = 5;

/** Strip guardrail annotations before sending a block back to the server. */
function rawBlock(b: GuardedBlock): LessonBlock {
  const { citations: _c, verification: _v, ...raw } = b;
  return raw as LessonBlock;
}

/** Cheap content hash: remounts a widget whenever its block content changes (resets its local state). */
function blockKey(b: GuardedBlock): string {
  const str = JSON.stringify(b);
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return `${b.id}:${(h >>> 0).toString(36)}`;
}

interface Toast {
  tone: "ok" | "error";
  text: string;
  action?: { label: string; run: () => void };
}

interface DiagnosticStage {
  kind: "diagnostic";
  questions: DiagnosticQuestion[];
  sources: { id: string; label: string; url: string; origin?: string }[];
  weakSources: boolean;
  notice?: string;
  /** Answers and options to pre-fill (coming back after a failed lesson build). */
  initial?: { answers: DiagnosticAnswer[]; options: LessonOptions };
}

type Stage =
  | { kind: "loading"; label: string; steps: string[] }
  | {
      kind: "error";
      message: string;
      /** Repeat the step that failed (default: restart the diagnostic). */
      retry?: () => void;
      /** Return to the diagnostic answers without rebuilding. */
      back?: () => void;
    }
  | DiagnosticStage
  | { kind: "ready" };

interface DisputeTarget {
  kind: "block" | "grading";
  block?: GuardedBlock;
  item?: RubricItem;
}

export function Workspace({ topic }: { topic: string }) {
  const [stage, setStage] = useState<Stage>({ kind: "loading", label: "Opening your workspace", steps: [] });
  const [session, setSession] = useState<Session | null>(null);
  const [folder, setFolder] = useState<Folder>(() => ({ slug: "", topic, notes: [], scores: [], updatedAt: "" }));
  const [tab, setTab] = useState<"learn" | "teach">("learn");
  const [notesOpen, setNotesOpen] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dispute, setDispute] = useState<DisputeTarget | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [reimagine, setReimagine] = useState<ReimagineTarget | null>(null);
  const [busyBlocks, setBusyBlocks] = useState<Set<string>>(new Set());
  const [offline, setOffline] = useState(false);

  // Async results (notes, disputes, several reimagines at once) must apply to the
  // LATEST session, not the one captured when the request started.
  const sessionRef = useRef<Session | null>(null);
  const persist = useCallback((s: Session) => {
    sessionRef.current = s;
    setSession(s);
    saveSession(s);
  }, []);
  const update = useCallback(
    (fn: (s: Session) => Session) => {
      if (sessionRef.current) persist(fn(sessionRef.current));
    },
    [persist],
  );

  /* ---------- boot: resume a saved session or start the diagnostic ---------- */
  const startDiagnostic = useCallback(async () => {
    setStage({
      kind: "loading",
      label: "Preparing your diagnostic",
      steps: ["Archivist: searching trusted repos and the web", "Assessor: writing calibration questions"],
    });
    try {
      const d = await api<{
        questions: DiagnosticQuestion[];
        sources: { id: string; label: string; url: string; origin?: string }[];
        weakSources: boolean;
        notice?: string;
      }>("diagnostic", { topic, extraDocs: getUploads() });
      setStage({ kind: "diagnostic", ...d });
    } catch (e) {
      setStage({ kind: "error", message: (e as Error).message });
    }
  }, [topic]);

  // React StrictMode (dev) runs mount effects twice; boot once so the diagnostic
  // (an LLM call) isn't requested twice. A new topic remounts via key, resetting this.
  const booted = useRef(false);
  useEffect(() => {
    if (window.innerWidth < 980) setNotesOpen(false); // drawer overlays the lesson on small screens
    setFolder(getFolder(topic));
    fetch("/api/status")
      .then((r) => r.json())
      .then((s: { provider?: string }) => setOffline(s.provider === "mock"))
      .catch(() => {});
    if (!booted.current) {
      booted.current = true;
      const saved = getSession(topic);
      if (saved) {
        sessionRef.current = saved;
        setSession(saved);
        setStage({ kind: "ready" });
      } else startDiagnostic();
    }
    return () => stopSpeaking();
  }, [topic, startDiagnostic]);

  async function submitDiagnostic(diag: DiagnosticStage, answers: DiagnosticAnswer[], options: LessonOptions) {
    const { questions } = diag;
    setStage({
      kind: "loading",
      label: "Building your interactive lesson",
      steps: [
        "Assessor: building your learner profile",
        `Sandbox Architect: assembling ${describeOptions(options)}`,
        "Quality agent: checking formulas, diagrams and citations",
        "Archivist: writing the hidden teach-back rubric",
      ],
    });
    try {
      const r = await api<{
        profile: LearnerProfile;
        lesson: Lesson;
        rubric: RubricItem[];
        sources: Session["sources"];
        guardReport: unknown;
        notice?: string;
      }>("lesson", { topic, questions, answers, options, extraDocs: getUploads() });
      const { notice, ...rest } = r;
      persist({ topic, ...rest });
      if (notice) setToast({ tone: "ok", text: notice });
      setStage({ kind: "ready" });
      window.scrollTo({ top: 0 });
    } catch (e) {
      // Keep the learner's answers: retry the build, or go back and change them.
      setStage({
        kind: "error",
        message: (e as Error).message,
        retry: () => submitDiagnostic(diag, answers, options),
        back: () => setStage({ ...diag, initial: { answers, options } }),
      });
    }
  }

  /* ---------- notes ---------- */
  const capture = useCallback(
    async (block: GuardedBlock, state: Record<string, unknown>, focus?: Focus) => {
      setNotesOpen(true);
      setDraft({ blockId: block.id, loading: true, title: focus?.title ?? block.title, markdown: "", snapshot: state });
      try {
        const note = await api<NoteDraft>("notes", { topic, block: rawBlock(block), state, focus });
        setDraft({ blockId: block.id, loading: false, ...note, snapshot: state });
      } catch (e) {
        setDraft({
          blockId: block.id,
          loading: false,
          title: focus?.title ?? block.title,
          markdown: focus?.detail ?? "",
          snapshot: state,
          error: `Couldn't auto-extract (${(e as Error).message}). Write your own note:`,
        });
      }
    },
    [topic],
  );

  const updateFolder = (f: Folder) => {
    // Keep the topic the folder was opened with: the home page links to /study?topic=<folder.topic>,
    // which must slugify back to this folder (offline, lesson.topic is always the TCP demo's title).
    const next = { ...f, topic };
    saveFolder(next);
    setFolder(next);
  };

  /* ---------- navigation between Pupil gaps and lesson blocks ---------- */
  const review = (blockId: string) => {
    setTab("learn");
    setTimeout(() => {
      document.getElementById(`block-${blockId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setFlash(blockId);
      setTimeout(() => setFlash(null), 3400);
    }, 60);
  };

  /* ---------- block replacement with undo history ---------- */
  const replaceBlock = useCallback(
    (next: GuardedBlock) =>
      update((s) => {
        const old = s.lesson.blocks.find((b) => b.id === next.id);
        const revisions = { ...(s.revisions ?? {}) };
        if (old) revisions[next.id] = [...(revisions[next.id] ?? []), old].slice(-MAX_REVISIONS);
        return { ...s, revisions, lesson: { ...s.lesson, blocks: s.lesson.blocks.map((b) => (b.id === next.id ? next : b)) } };
      }),
    [update],
  );

  const undoBlock = (block: GuardedBlock) =>
    update((s) => {
      const stack = [...(s.revisions?.[block.id] ?? [])];
      const prev = stack.pop();
      if (!prev) return s;
      return {
        ...s,
        revisions: { ...s.revisions, [block.id]: stack },
        lesson: { ...s.lesson, blocks: s.lesson.blocks.map((b) => (b.id === block.id ? prev : b)) },
      };
    });

  /* ---------- reimagine (✦) ---------- */
  const setBusy = (id: string, on: boolean) =>
    setBusyBlocks((cur) => {
      const n = new Set(cur);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  async function submitReimagine(target: ReimagineTarget, req: ReimagineRequest) {
    const s = sessionRef.current;
    if (!s) return;
    setReimagine(null);
    const outline = s.lesson.blocks.map((b) => ({ id: b.id, type: b.type, title: b.title }));
    const common = { topic: s.lesson.topic, profile: s.profile, outline, extraDocs: getUploads() };

    if (target.kind === "block") {
      const id = target.block.id;
      setBusy(id, true);
      try {
        const r = await api<{ block: GuardedBlock; notice?: string }>("reimagine", {
          ...common,
          scope: "block",
          instruction: req.instruction,
          preferType: req.preferType,
          block: rawBlock(target.block),
          options: s.lesson.options,
        });
        if (r.notice) setToast({ tone: "error", text: r.notice });
        else {
          replaceBlock(r.block);
          setToast({
            tone: "ok",
            text: `Reimagined “${r.block.title}”.`,
            action: { label: "↶ Undo", run: () => undoBlock(r.block) },
          });
        }
      } catch (e) {
        setToast({ tone: "error", text: `Couldn't reimagine that section: ${(e as Error).message}` });
      } finally {
        setBusy(id, false);
      }
      return;
    }

    const options = req.options ?? s.lesson.options;
    setStage({
      kind: "loading",
      label: "Reimagining your lesson",
      steps: [
        `Sandbox Architect: rebuilding as ${describeOptions(options)}`,
        "Quality agent: checking formulas, diagrams and citations",
        "Archivist: writing a new teach-back rubric",
      ],
    });
    try {
      const r = await api<{ lesson: Lesson; rubric: RubricItem[]; sources: Session["sources"]; guardReport: unknown; notice?: string }>(
        "reimagine",
        { ...common, scope: "lesson", instruction: req.instruction, options },
      );
      const cur = sessionRef.current ?? s;
      persist({
        ...cur,
        previous: { lesson: cur.lesson, rubric: cur.rubric, sources: cur.sources, teach: cur.teach },
        lesson: r.lesson,
        rubric: r.rubric,
        sources: r.sources,
        guardReport: r.guardReport,
        teach: undefined,
        revisions: {},
      });
      setToast({ tone: "ok", text: r.notice ?? `Lesson reimagined: ${r.lesson.title}.`, action: { label: "↶ Undo", run: undoLesson } });
      window.scrollTo({ top: 0 });
    } catch (e) {
      setToast({ tone: "error", text: `Couldn't reimagine the lesson: ${(e as Error).message}` });
    } finally {
      setStage({ kind: "ready" });
    }
  }

  function undoLesson() {
    update((s) => {
      if (!s.previous) return s;
      const { previous, ...rest } = s;
      return { ...rest, lesson: previous.lesson, rubric: previous.rubric, sources: previous.sources, teach: previous.teach, revisions: {} };
    });
    setToast({ tone: "ok", text: "Restored the previous lesson." });
  }

  /* ---------- disputes (Agent 5) ---------- */
  async function submitDispute(complaint: string) {
    if (!dispute || !session) return;
    const target = dispute;
    setDispute(null);
    setToast({ tone: "ok", text: "Quality agent is reviewing your flag…" });
    try {
      const r = await api<{
        verdict: "upheld" | "rejected";
        explanation: string;
        block?: GuardedBlock;
        rubricItem?: RubricItem;
        regradeTo?: "pending" | "mastered" | "gap";
      }>("dispute", {
        topic: session.lesson.topic,
        kind: target.kind,
        complaint,
        block: target.block ? rawBlock(target.block) : undefined,
        rubricItem: target.item,
        currentStatus: target.item ? session.teach?.statuses[target.item.id] : undefined,
        transcript: session.teach?.transcript.slice(-LIMITS.transcript),
        extraDocs: getUploads(),
      });
      if (r.block) replaceBlock(r.block);
      update((cur) => {
        const next: Session = structuredClone(cur);
        if (r.rubricItem) next.rubric = next.rubric.map((it) => (it.id === r.rubricItem!.id ? r.rubricItem! : it));
        // Only an upheld dispute changes the grade (the server also strips regrades from rejections).
        if (r.verdict === "upheld" && r.regradeTo && target.item && next.teach)
          next.teach.statuses[target.item.id] = { status: r.regradeTo, evidence: "Re-graded after review" };
        return next;
      });
      setToast({ tone: r.verdict === "upheld" ? "ok" : "error", text: `${r.verdict === "upheld" ? "Upheld" : "Not changed"}: ${r.explanation}` });
      if (r.block) review(r.block.id);
    } catch (e) {
      setToast({ tone: "error", text: (e as Error).message });
    }
  }

  /* ---------- render ---------- */
  const lesson = session?.lesson;
  const keys = useMemo(() => new Map((lesson?.blocks ?? []).map((b) => [b.id, blockKey(b)])), [lesson?.blocks]);
  const hasTeachProgress = !!session?.teach?.transcript.some((m) => m.role === "learner");
  return (
    <>
      <nav className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden /> Feynman Lab
        </Link>
        <span className="tag">{lesson?.topic ?? topic}</span>
        {session && lesson && (
          <span className="tag blue" title={describeOptions(lesson.options)}>
            {DEPTHS[lesson.depth]?.label ?? session.profile.level}
          </span>
        )}
        <span className="spacer" />
        {stage.kind === "ready" && (
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "learn"} onClick={() => setTab("learn")}>
              1 · Learn
            </button>
            <button role="tab" aria-selected={tab === "teach"} onClick={() => setTab("teach")}>
              2 · Teach the Pupil
            </button>
          </div>
        )}
        <button className="btn sm" onClick={() => setNotesOpen((o) => !o)} aria-pressed={notesOpen}>
          Notes ({folder.notes.length})
        </button>
        <ThemeToggle />
      </nav>

      <div className={`workspace ${notesOpen ? "" : "notes-closed"}`}>
        <main style={{ minWidth: 0 }}>
          {toast && (
            <div className={toast.tone === "ok" ? "note-ok" : "warn"} style={{ margin: "16px auto 0", maxWidth: 900 }} role="status">
              <div className="row">
                <span style={{ flex: 1 }}>{toast.text}</span>
                {toast.action && (
                  <button
                    className="btn sm"
                    onClick={() => {
                      toast.action!.run();
                    }}
                  >
                    {toast.action.label}
                  </button>
                )}
                <button className="btn ghost sm" onClick={() => setToast(null)}>
                  ✕
                </button>
              </div>
            </div>
          )}

          {stage.kind === "loading" && (
            <div className="center">
              <div>
                <div className="loader" />
                <h2>{stage.label}…</h2>
                <div className="agentlog">
                  {stage.steps.map((s) => (
                    <div key={s}>{s}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {stage.kind === "error" && (
            <div className="center">
              <div className="card" style={{ maxWidth: 560, textAlign: "left" }}>
                <span className="tag red">Something went wrong</span>
                <p style={{ marginTop: 12 }}>{stage.message}</p>
                <p className="small muted">
                  Check <code>LLM_PROVIDER</code> and the API key in <code>.env.local</code>, or set <code>LLM_PROVIDER=mock</code> for the offline
                  demo.
                </p>
                <div className="row">
                  <button className="btn primary" onClick={stage.retry ?? startDiagnostic}>
                    Try again
                  </button>
                  {stage.back && (
                    <button className="btn" onClick={stage.back}>
                      Back to my answers
                    </button>
                  )}
                  {stage.retry && (
                    <button className="btn ghost" onClick={startDiagnostic}>
                      New diagnostic
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {stage.kind === "diagnostic" && (
            <DiagnosticPanel
              topic={topic}
              questions={stage.questions}
              sources={stage.sources}
              weakSources={stage.weakSources}
              notice={stage.notice}
              initial={stage.initial}
              onSubmit={(a, o) => submitDiagnostic(stage, a, o)}
            />
          )}

          {stage.kind === "ready" && session && lesson && tab === "learn" && (
            <div className="canvas">
              <div className="canvas-inner">
                <header>
                  <span className="tag blue">Agent 3 · Sandbox Architect</span>
                  <h1 style={{ marginTop: 12 }}>{lesson.title}</h1>
                  <p>{lesson.summary}</p>
                  <div className="card small" style={{ padding: 14 }}>
                    <strong>Built for you: </strong>
                    {session.profile.summary}{" "}
                    <span className="muted">
                      (diagnostic score {Math.round(session.profile.score * 100)}% · {describeOptions(lesson.options)})
                    </span>
                  </div>
                  {lesson.blocks.some((b) => b.verification.status === "model") && (
                    <p className="small muted" style={{ margin: "10px 0 0" }}>
                      Sources for this topic were thin, so some sections come from the model’s general knowledge. They’re marked{" "}
                      <span className="tag model">◇ model knowledge</span>.
                    </p>
                  )}
                </header>

                {!session.hintDismissed ? (
                  <div className="reimagine-hint" role="note">
                    <Sparkle size={30} />
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <strong>Make it yours.</strong> Not what you pictured? Click <Sparkle size={14} /> beside any section title to reshape
                      just that part (simpler, deeper, a new analogy, a diagram instead of text), or reimagine the whole lesson at once.
                    </div>
                    <div className="row">
                      <button className="btn sm primary" onClick={() => setReimagine({ kind: "lesson" })}>
                        <Sparkle size={14} mono /> Reimagine whole lesson
                      </button>
                      <button className="btn sm ghost" onClick={() => update((s) => ({ ...s, hintDismissed: true }))}>
                        Got it
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="row" style={{ marginTop: -12 }}>
                    <span className="spacer" />
                    {session.previous && (
                      <button className="btn ghost sm" onClick={undoLesson}>
                        ↶ Previous lesson
                      </button>
                    )}
                    <button className="btn sm" onClick={() => setReimagine({ kind: "lesson" })}>
                      <Sparkle size={14} /> Reimagine whole lesson
                    </button>
                  </div>
                )}

                {lesson.blocks.map((b, i) => (
                  <BlockFrame
                    key={keys.get(b.id) ?? b.id}
                    block={b}
                    index={i}
                    flash={flash === b.id}
                    busy={busyBlocks.has(b.id)}
                    canUndo={!!session.revisions?.[b.id]?.length}
                    onCapture={capture}
                    onFlag={(block) => setDispute({ kind: "block", block })}
                    onReimagine={(block) => setReimagine({ kind: "block", block })}
                    onUndo={undoBlock}
                  />
                ))}
                <div className="card row">
                  <div style={{ flex: 1 }}>
                    <h2 style={{ margin: 0 }}>Think you’ve got it?</h2>
                    <p className="muted" style={{ margin: 0 }}>
                      The real test is explaining it. Teach it to the Pupil.
                    </p>
                  </div>
                  <button
                    className="btn primary"
                    onClick={() => {
                      setTab("teach");
                      window.scrollTo({ top: 0 });
                    }}
                  >
                    Teach the Pupil →
                  </button>
                </div>
                <div className="row small muted">
                  <span>Grounded in {session.sources.length} source sections.</span>
                  <span className="spacer" />
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      clearSession(topic);
                      sessionRef.current = null;
                      setSession(null);
                      setTab("learn");
                      startDiagnostic();
                    }}
                  >
                    Retake diagnostic & rebuild lesson
                  </button>
                </div>
              </div>
            </div>
          )}

          {stage.kind === "ready" && session && tab === "teach" && (
            <PupilPanel
              session={session}
              onChange={(t) => update((s) => ({ ...s, teach: t }))}
              onReview={review}
              onDispute={(item) => setDispute({ kind: "grading", item })}
              onScore={(sc, difficulty) =>
                updateFolder({
                  ...folder,
                  scores: [
                    ...folder.scores,
                    {
                      at: new Date().toISOString(),
                      difficulty,
                      score: sc.score,
                      mastered: sc.mastered.map((m) => m.concept),
                      gaps: sc.gaps.map((g) => g.concept),
                    },
                  ],
                })
              }
            />
          )}
        </main>

        <NotesDrawer
          folder={folder}
          draft={draft}
          onClose={() => setNotesOpen(false)}
          onDiscard={() => setDraft(null)}
          onSave={(d, attach) => {
            updateFolder({
              ...folder,
              notes: [
                ...folder.notes,
                {
                  id: `n_${Date.now().toString(36)}`,
                  blockId: d.blockId,
                  title: d.title,
                  markdown: d.markdown,
                  snapshot: attach ? d.snapshot : undefined,
                  createdAt: new Date().toISOString(),
                },
              ],
            });
            setDraft(null);
          }}
          onDelete={(id) => updateFolder({ ...folder, notes: folder.notes.filter((n) => n.id !== id) })}
          onUpdate={(n) => updateFolder({ ...folder, notes: folder.notes.map((x) => (x.id === n.id ? n : x)) })}
          onExport={() => download(`${folder.slug || "notes"}-study-sheet.md`, folderToMarkdown({ ...folder, topic: lesson?.topic ?? topic }))}
          onJump={review}
        />
      </div>

      {dispute && <DisputeDialog target={dispute} onCancel={() => setDispute(null)} onSubmit={submitDispute} />}
      {reimagine && session && (
        <ReimagineDialog
          target={reimagine}
          options={session.lesson.options}
          offline={offline}
          hasTeachProgress={hasTeachProgress}
          onCancel={() => setReimagine(null)}
          onSubmit={(req) => submitReimagine(reimagine, req)}
        />
      )}
    </>
  );
}

function DisputeDialog({
  target,
  onCancel,
  onSubmit,
}: {
  target: DisputeTarget;
  onCancel: () => void;
  onSubmit: (complaint: string) => void;
}) {
  const presets =
    target.kind === "block"
      ? ["This explanation is confusing", "The widget is broken or doesn't respond", "This looks factually wrong"]
      : ["I did explain this", "The question was unfair or unclear", "The lesson never covered this"];
  const [text, setText] = useState("");
  return (
    <div className="dialog-back" role="dialog" aria-modal="true" aria-labelledby="dispute-h" onClick={onCancel}>
      <div className="card dialog stack" onClick={(e) => e.stopPropagation()}>
        <span className="tag blue">Agent 5 · Quality & learner advocate</span>
        <h2 id="dispute-h" style={{ margin: 0 }}>
          {target.kind === "block" ? `Flag “${target.block?.title}”` : `Dispute grading: “${target.item?.concept}”`}
        </h2>
        <div className="chips">
          {presets.map((p) => (
            <button key={p} className="chip" onClick={() => setText(p)}>
              {p}
            </button>
          ))}
        </div>
        <textarea
          className="textarea"
          style={{ fontFamily: "var(--font)" }}
          value={text}
          maxLength={LIMITS.complaint}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's wrong? Be specific and the agent can fix it."
          autoFocus
        />
        <div className="row">
          <span className="spacer" />
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={text.trim().length < 3} onClick={() => onSubmit(text.trim())}>
            Send to quality agent
          </button>
        </div>
      </div>
    </div>
  );
}
