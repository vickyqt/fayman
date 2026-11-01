/**
 * Minimal, safe markdown renderer (no dangerouslySetInnerHTML): paragraphs,
 * "- " / "1. " lists, > quotes, **bold**, *italic*, `code` and [links](url).
 */
import React from "react";

function inline(text: string, key = 0): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Emphasis must hug its text (`*word*`, not `a * b * c`), and `_x_` only counts at word
  // boundaries, so snake_case identifiers like max_retry_count stay intact.
  const re =
    /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s](?:[^*]*[^*\s])?\*|(?<![\p{L}\p{N}_])_[^_\s](?:[^_]*[^_\s])?_(?![\p{L}\p{N}_])|\[[^\]]+\]\((https?:[^)\s]+)\))/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const label = t.slice(1, t.indexOf("]"));
      out.push(
        <a key={k} href={m[2]} target="_blank" rel="noreferrer">
          {label}
        </a>,
      );
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Seg = { kind: "ul" | "ol" | "quote" | "h" | "p"; lines: string[] };

function segment(text: string): Seg[] {
  const segs: Seg[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      segs.push({ kind: "p", lines: [] }); // paragraph break
      continue;
    }
    const kind: Seg["kind"] = /^\s*[-*]\s+/.test(line)
      ? "ul"
      : /^\s*\d+[.)]\s+/.test(line)
        ? "ol"
        : line.startsWith(">")
          ? "quote"
          : /^#{1,4}\s+/.test(line)
            ? "h"
            : "p";
    const last = segs[segs.length - 1];
    if (last && last.kind === kind && kind !== "h" && last.lines.length) last.lines.push(line);
    else segs.push({ kind, lines: [line] });
  }
  return segs.filter((x) => x.lines.length);
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`md ${className ?? ""}`}>
      {segment(text).map((seg, i) => {
        switch (seg.kind) {
          case "ul":
            return (
              <ul key={i}>
                {seg.lines.map((l, j) => (
                  <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ""), j)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i}>
                {seg.lines.map((l, j) => (
                  <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""), j)}</li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote key={i} className="analogy">
                {inline(seg.lines.map((l) => l.replace(/^>\s?/, "")).join(" "), i)}
              </blockquote>
            );
          case "h":
            return <h3 key={i}>{inline(seg.lines[0].replace(/^#{1,4}\s+/, ""), i)}</h3>;
          default:
            return <p key={i}>{inline(seg.lines.join(" "), i)}</p>;
        }
      })}
    </div>
  );
}
