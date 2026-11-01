"use client";
import { useEffect, useState } from "react";
import type { BlockProps, Of } from "./types";

export function PredictionBlock({ block, onState }: BlockProps<Of<"predict">>) {
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => {
    onState(pick === null ? { answered: false } : { picked: block.options[pick], correct: pick === block.correctIndex });
  }, [pick, block, onState]);

  return (
    <div className="stack">
      <p style={{ fontWeight: 600, margin: 0 }}>{block.question}</p>
      {block.options.map((o, i) => {
        const cls =
          pick === null ? "" : i === block.correctIndex ? "right" : i === pick ? "wrong" : "";
        return (
          <button key={i} className={`opt ${cls}`} disabled={pick !== null} onClick={() => setPick(i)}>
            <span className="letter">{String.fromCharCode(65 + i)}</span>
            <span>{o}</span>
          </button>
        );
      })}
      {pick !== null && (
        <div className={pick === block.correctIndex ? "note-ok" : "warn"}>
          <strong>{pick === block.correctIndex ? "Correct. " : "Not quite. "}</strong>
          {block.explanation}
          <div style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => setPick(null)}>
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
