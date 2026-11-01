"use client";
import { Component, useCallback, useRef, type ReactNode } from "react";
import type { GuardedBlock } from "@/lib/schemas";
import { speak, stopSpeaking, useSpeechOwner } from "@/lib/client/speech";
import { Sparkle } from "@/components/Sparkle";
import { REGISTRY } from "./registry";
import type { Focus } from "./types";

/** If one generated widget throws, only that card fails, not the lesson. */
class Boundary extends Component<{ children: ReactNode; onFlag: () => void }, { err?: string }> {
  state: { err?: string } = {};
  static getDerivedStateFromError(e: Error) {
    return { err: e.message };
  }
  render() {
    if (this.state.err)
      return (
        <div className="warn">
          <strong>This widget failed to render.</strong> {this.state.err}{" "}
          <button className="btn sm" onClick={this.props.onFlag}>
            Report & regenerate
          </button>
        </div>
      );
    return this.props.children;
  }
}

export function BlockFrame({
  block,
  index,
  flash,
  busy,
  canUndo,
  onCapture,
  onFlag,
  onReimagine,
  onUndo,
}: {
  block: GuardedBlock;
  index: number;
  flash: boolean;
  /** A reimagine request for this block is in flight. */
  busy: boolean;
  canUndo: boolean;
  onCapture: (block: GuardedBlock, state: Record<string, unknown>, focus?: Focus) => void;
  onFlag: (block: GuardedBlock) => void;
  onReimagine: (block: GuardedBlock) => void;
  onUndo: (block: GuardedBlock) => void;
}) {
  const entry = REGISTRY[block.type];
  const stateRef = useRef<Record<string, unknown>>({});
  const onState = useCallback((s: Record<string, unknown>) => {
    stateRef.current = s;
  }, []);
  const capture = useCallback((focus?: Focus) => onCapture(block, stateRef.current, focus), [block, onCapture]);
  const me = `block:${block.id}`;
  const speaking = useSpeechOwner() === me;
  const narrate = useCallback((text: string, onEnd?: () => void) => speak(text, { owner: me, onEnd }), [me]);
  const v = block.verification;
  const narration =
    block.narration ??
    ("description" in block ? block.description : block.type === "predict" ? block.question : block.title);

  return (
    <section
      id={`block-${block.id}`}
      className={`block ${flash ? "flash" : ""} ${busy ? "busy" : ""}`}
      aria-labelledby={`h-${block.id}`}
      aria-busy={busy}
    >
      <header className="block-head">
        <span className="tag">
          {String(index + 1).padStart(2, "0")} · {entry?.label ?? block.type}
        </span>
        <h2 id={`h-${block.id}`}>{block.title}</h2>
        <button
          className="sparkle-btn"
          onClick={() => onReimagine(block)}
          disabled={busy}
          title="Reimagine this section your way"
          aria-label={`Reimagine “${block.title}”`}
        >
          <Sparkle size={18} />
        </button>
        <span className="spacer" />
        {canUndo && (
          <button className="btn ghost sm" onClick={() => onUndo(block)} disabled={busy} title="Restore the previous version">
            ↶ Undo
          </button>
        )}
        {v.status === "verified" && <span className="tag green" title="Citations resolved and checks passed">✓ sourced</span>}
        {v.status === "repaired" && <span className="tag blue" title={v.issues.join("\n")}>auto-repaired</span>}
        {v.status === "model" && (
          <span className="tag model" title={v.issues.join("\n")}>
            ◇ model knowledge
          </span>
        )}
        {v.status === "unverified" && <span className="tag red" title={v.issues.join("\n")}>unverified</span>}
      </header>
      <div className="block-body">
        {v.status === "unverified" && (
          <div className="warn" style={{ marginBottom: 14 }}>
            <strong>Quality agent: </strong>
            {v.issues.slice(0, 2).join(" · ")}
          </div>
        )}
        {entry ? (
          <Boundary onFlag={() => onFlag(block)}>
            <entry.Component block={block} onState={onState} onCapture={capture} narrate={narrate} />
          </Boundary>
        ) : (
          <div className="warn">Unsupported block type “{block.type}”.</div>
        )}
      </div>
      <footer className="block-foot">
        {block.citations.length ? (
          block.citations.map((c) =>
            c.url ? (
              <a key={c.chunkId} className="cite" href={c.url} target="_blank" rel="noreferrer" title={c.label}>
                ↗ {c.label}
              </a>
            ) : (
              <span key={c.chunkId} className="cite" title={c.label}>
                ◆ {c.label}
              </span>
            ),
          )
        ) : (
          <span className="small muted">{v.status === "model" ? "From the model's general knowledge" : "No source"}</span>
        )}
        <span className="spacer" />
        <button
          className="btn ghost sm"
          onClick={() => (speaking ? stopSpeaking() : narrate(narration))}
          aria-pressed={speaking}
          aria-label={speaking ? "Stop reading this block" : "Read this block aloud"}
        >
          {speaking ? "■ Stop" : "🔊 Narrate"}
        </button>
        <button className="btn ghost sm" onClick={() => onFlag(block)}>
          ⚑ Flag issue
        </button>
        <button className="btn sm primary" onClick={() => capture()}>
          ＋ Capture to notes
        </button>
      </footer>
      {busy && (
        <div className="busy-veil" role="status">
          <Sparkle size={28} className="spin-sparkle" />
          <strong>Reimagining this section…</strong>
        </div>
      )}
    </section>
  );
}
