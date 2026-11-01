"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkle } from "@/components/Sparkle";
import type { BlockType, GuardedBlock, LessonOptions } from "@/lib/schemas";
import { LIMITS } from "@/lib/limits";
import { LessonOptionsPicker } from "./LessonOptionsPicker";

export type ReimagineTarget = { kind: "block"; block: GuardedBlock } | { kind: "lesson" };

export interface ReimagineRequest {
  instruction: string;
  preferType?: BlockType;
  options?: LessonOptions;
}

const TYPE_LABEL: Record<BlockType, string> = {
  concept: "Explanation card",
  slider: "Simulation (sliders)",
  stepper: "Step-through sequence",
  architecture: "Interactive diagram",
  code: "Code trace",
  predict: "Prediction quiz",
};

const BLOCK_PRESETS = [
  "Explain it more simply",
  "Go deeper on the details",
  "Use a real-world analogy",
  "Make it interactive",
  "Add a worked example",
  "Make it shorter",
  "Quiz me on it",
];

const LESSON_PRESETS = [
  "Make it more visual",
  "Use everyday analogies throughout",
  "Focus on interview prep",
  "More code, less prose",
  "Explain like I'm new to programming",
  "Focus on real-world production issues",
];

export function ReimagineDialog({
  target,
  options,
  offline,
  hasTeachProgress,
  onCancel,
  onSubmit,
}: {
  target: ReimagineTarget;
  /** Current lesson options (pre-fill for a whole-lesson rebuild). */
  options: LessonOptions;
  offline: boolean;
  hasTeachProgress: boolean;
  onCancel: () => void;
  onSubmit: (r: ReimagineRequest) => void;
}) {
  const [text, setText] = useState("");
  const [type, setType] = useState<BlockType | "">("");
  const [opts, setOpts] = useState<LessonOptions>(options);
  const area = useRef<HTMLTextAreaElement>(null);
  const isBlock = target.kind === "block";
  const presets = isBlock ? BLOCK_PRESETS : LESSON_PRESETS;
  const optsChanged = JSON.stringify(opts) !== JSON.stringify(options);
  const canSend = isBlock ? text.trim().length >= 3 : text.trim().length >= 3 || optsChanged;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const addPreset = (p: string) => {
    setText((t) => (t.trim() ? `${t.trim().replace(/[.;,]$/, "")}; ${p.toLowerCase()}` : p));
    area.current?.focus();
  };

  const submit = () => {
    if (!canSend) return;
    onSubmit(isBlock ? { instruction: text.trim(), preferType: type || undefined } : { instruction: text.trim(), options: opts });
  };

  return (
    <div className="dialog-back" role="dialog" aria-modal="true" aria-labelledby="reimagine-h" onClick={onCancel}>
      <div className={`card dialog stack ${isBlock ? "" : "dialog-wide"}`} onClick={(e) => e.stopPropagation()}>
        <span className="tag blue" style={{ alignSelf: "flex-start" }}>
          <Sparkle size={12} /> Reimagine
        </span>
        <h2 id="reimagine-h" style={{ margin: 0 }}>
          {isBlock ? `Reshape “${target.block.title}”` : "Reimagine the whole lesson"}
        </h2>
        <p className="small muted" style={{ margin: 0 }}>
          {isBlock
            ? "Describe how you imagined this section: tone, examples, depth, or a different kind of widget. Only this section changes."
            : "Describe how the lesson should look or feel, and/or change its length, depth and amount of interactive content."}
        </p>

        {offline && (
          <div className="warn">
            <strong>Offline demo.</strong>{" "}
            {isBlock
              ? "Rewriting a section to your description needs a real model."
              : "New length, depth and interactivity settings apply offline; rewriting to your description needs a real model."}{" "}
            Set <code>LLM_PROVIDER</code> in <code>.env.local</code>.
          </div>
        )}

        <div className="chips">
          {presets.map((p) => (
            <button key={p} type="button" className="chip" onClick={() => addPreset(p)}>
              {p}
            </button>
          ))}
        </div>
        <textarea
          ref={area}
          className="textarea"
          style={{ fontFamily: "var(--font)", fontSize: 15, minHeight: 96 }}
          value={text}
          maxLength={LIMITS.instruction}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder={
            isBlock
              ? "e.g. Explain it like a restaurant kitchen, and let me drag the steps into order"
              : "e.g. Make every section about a real outage, with more diagrams"
          }
          autoFocus
          aria-label="What did you imagine?"
        />

        {isBlock ? (
          <label className="small stack" style={{ gap: 6 }}>
            <strong>Turn it into</strong>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as BlockType | "")}>
              <option value="">Let the Teacher decide (currently: {TYPE_LABEL[target.block.type]})</option>
              {(Object.keys(TYPE_LABEL) as BlockType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <div style={{ borderTop: "1.5px dashed var(--edge)", paddingTop: 14 }}>
              <LessonOptionsPicker value={opts} onChange={(p) => setOpts((o) => ({ ...o, ...p }))} />
            </div>
            {hasTeachProgress && (
              <div className="insight small" style={{ margin: 0 }}>
                Rebuilding the lesson writes a new teach-back checklist, so your current Pupil conversation restarts. You can undo afterwards.
              </div>
            )}
          </>
        )}

        <div className="row">
          <span className="small muted">⌘/Ctrl + Enter</span>
          <span className="spacer" />
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!canSend} onClick={submit}>
            <Sparkle size={16} mono /> {isBlock ? "Reimagine section" : "Reimagine lesson"}
          </button>
        </div>
      </div>
    </div>
  );
}
