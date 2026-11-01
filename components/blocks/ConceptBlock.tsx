"use client";
import { useEffect } from "react";
import { Markdown } from "@/lib/client/md";
import type { BlockProps, Of } from "./types";

export function ConceptBlock({ block, onState }: BlockProps<Of<"concept">>) {
  useEffect(() => {
    onState({});
  }, [onState]);
  return (
    <div>
      <Markdown text={block.body} />
      {block.analogy && (
        <div className="analogy">
          <strong>Analogy. </strong>
          {block.analogy}
        </div>
      )}
      {block.keyPoints.length > 0 && (
        <ul className="keypoints">
          {block.keyPoints.map((k, i) => (
            <li key={i}>{k}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
