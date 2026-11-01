"use client";
import { useEffect, useState } from "react";
import type { BlockProps, Of } from "./types";

export function ConceptCodeTracer({ block, onState, onCapture }: BlockProps<Of<"code">>) {
  const [i, setI] = useState(0);
  const step = block.trace[i];
  const prev = i > 0 ? block.trace[i - 1] : undefined;
  const lines = block.code.split("\n");

  useEffect(() => {
    onState({ step: `${i + 1}/${block.trace.length}`, line: step.line, ...step.vars });
  }, [i, step, block.trace.length, onState]);

  return (
    <div>
      <div className="code" role="region" aria-label={`${block.language} code`}>
        {lines.map((l, k) => (
          <div key={k} className={`ln ${k + 1 === step.line ? `cur ${step.status}` : ""}`}>
            <span className="n">{k + 1}</span>
            {l || " "}
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <div className="controls">
          <button className="btn sm" onClick={() => setI(0)} aria-label="Restart">⏮</button>
          <button className="btn sm" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}>◀ Back</button>
          <button className="btn sm primary" onClick={() => setI((x) => Math.min(block.trace.length - 1, x + 1))} disabled={i >= block.trace.length - 1}>
            Step ▶
          </button>
        </div>
        <span className="spacer" />
        <span className="tag">
          trace {i + 1}/{block.trace.length} · line {step.line}
        </span>
      </div>
      <div className={`stepdetail ${step.status}`} aria-live="polite">
        <div className="row">
          <span>{step.note}</span>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={() => onCapture({ title: `${block.title} — line ${step.line}`, detail: step.note })}>
            ＋ Capture
          </button>
        </div>
      </div>
      {Object.keys(step.vars).length > 0 && (
        <div className="statevars">
          {Object.entries(step.vars).map(([k, v]) => (
            <div key={k} className={`statevar ${prev && prev.vars[k] !== v ? "changed" : ""}`}>
              <span className="k">{k}</span>
              {v}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
