"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deleteFolder, folderTopic, getUploads, listFolders, setUploads, type Folder } from "@/lib/client/store";
import { LIMITS } from "@/lib/limits";
import type { ExtraDoc } from "@/lib/schemas";
import { ThemeToggle } from "@/components/ThemeToggle";

const SUGGESTED = ["TCP 3-Way Handshake", "B-Tree Indexing", "React Fiber Reconciliation", "Docker Networking", "RAG Pipelines"];

interface Status {
  provider: string;
  model: string;
  web?: string;
  corpus: { seedDocs: number; githubDocs: number; chunks: number; repos: string[] };
}

export default function Home() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [uploads, setUp] = useState<ExtraDoc[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [uploadNote, setUploadNote] = useState("");

  useEffect(() => {
    setFolders(listFolders());
    setUp(getUploads());
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  const go = (t: string) => t.trim() && router.push(`/study?topic=${encodeURIComponent(t.trim())}`);

  async function addFiles(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = ""; // so picking the same file again still fires onChange
    if (!files.length) return;
    const docs: ExtraDoc[] = [...uploads];
    const skipped: string[] = [];
    let truncated = 0;
    for (const f of files) {
      if (!/\.(md|mdx|txt|markdown)$/i.test(f.name)) {
        skipped.push(`${f.name} (not .md/.txt)`);
        continue;
      }
      const raw = await f.text();
      if (raw.length > LIMITS.uploadChars) truncated++;
      const doc = { name: f.name.slice(0, 200), text: raw.slice(0, LIMITS.uploadChars) };
      const same = docs.findIndex((d) => d.name === doc.name);
      if (same >= 0) docs[same] = doc; // re-uploading a file replaces it
      else if (docs.length < LIMITS.uploads) docs.push(doc);
      else skipped.push(`${f.name} (limit is ${LIMITS.uploads} files)`);
    }
    setUp(docs);
    setUploads(docs);
    const notes = [
      skipped.length ? `Skipped ${skipped.join(", ")}.` : "",
      truncated ? `${truncated} file(s) were cut to the first ${LIMITS.uploadChars / 1000}k characters.` : "",
    ].filter(Boolean);
    setUploadNote(notes.join(" "));
  }

  return (
    <div className="home">
      <div className="row" style={{ marginBottom: 40 }}>
        <span className="brand">
          <span className="brand-mark" aria-hidden /> Feynman Lab
        </span>
        <span className="spacer" />
        {status && (
          <span className={`tag ${status.provider === "mock" ? "" : "green"}`} title={status.corpus.repos.join("\n")}>
            {status.provider === "mock" ? "offline demo" : `${status.provider} · ${status.model}`} · {status.corpus.chunks} source sections
            {status.web && status.web !== "off" ? " + web" : ""}
          </span>
        )}
        <ThemeToggle />
      </div>

      <div className="hero">
        <div>
          <span className="tag blue">AI for foundational learning in tech</span>
          <h1 style={{ marginTop: 14 }}>
            Learn it by doing.
            <br />
            Prove it by teaching.
          </h1>
          <p style={{ fontSize: 18, maxWidth: 560 }}>
            Pick any topic. A Teacher agent checks what you already know, then builds an interactive lesson grounded in trusted GitHub
            repos and the web, shaped to the length, depth and amount of hands-on content you choose.
            When you’re ready, explain it to a curious Pupil agent that won’t let hand-waving slide.
          </p>
        </div>

        <div className="card stack">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              go(topic);
            }}
          >
            <label htmlFor="topic" style={{ fontWeight: 700 }}>
              What do you want to master?
            </label>
            <input
              id="topic"
              className="input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={LIMITS.topic}
              placeholder="Any topic, e.g. Kafka consumer groups, CRDTs, TCP handshake"
              autoComplete="off"
            />
            <button className="btn primary" type="submit" disabled={!topic.trim()}>
              Start diagnostic →
            </button>
          </form>
          <div className="chips">
            {SUGGESTED.map((s) => (
              <button key={s} className="chip" onClick={() => go(s)}>
                {s}
              </button>
            ))}
          </div>
          <div style={{ borderTop: "1.5px dashed var(--edge)", paddingTop: 12 }}>
            <label className="small" style={{ fontWeight: 600 }}>
              Coursework / syllabus notes (.md, .txt, up to {LIMITS.uploads} files)
              <input
                type="file"
                accept=".md,.mdx,.txt,.markdown"
                multiple
                disabled={uploads.length >= LIMITS.uploads}
                onChange={(e) => addFiles(e.currentTarget)}
                style={{ display: "block", marginTop: 6 }}
              />
            </label>
            {uploadNote && (
              <p className="small muted" style={{ margin: "6px 0 0" }} role="status">
                {uploadNote}
              </p>
            )}
            {uploads.length > 0 && (
              <div className="row small" style={{ marginTop: 8 }}>
                {uploads.map((u) => (
                  <span key={u.name} className="tag blue">
                    {u.name}
                  </span>
                ))}
                <button
                  className="btn ghost sm"
                  onClick={() => {
                    setUp([]);
                    setUploads([]);
                    setUploadNote("");
                  }}
                >
                  clear
                </button>
              </div>
            )}
          </div>
          {status?.provider === "mock" && (
            <p className="small muted" style={{ margin: 0 }}>
              Running offline: the scripted <strong>TCP 3-Way Handshake</strong> lesson works end to end. Set <code>LLM_PROVIDER</code> to
              generate any topic.
            </p>
          )}
        </div>
      </div>

      <div className="loop">
        <div>
          <span className="tag">01 · diagnose</span>
          <p style={{ marginTop: 8 }}>3–4 quick questions set how deep your lesson starts.</p>
        </div>
        <div>
          <span className="tag blue">02 · learn by doing</span>
          <p style={{ marginTop: 8 }}>Sliders, step-through protocols, draggable diagrams, code traces. Reshape any section with ✦.</p>
        </div>
        <div>
          <span className="tag">03 · capture</span>
          <p style={{ marginTop: 8 }}>One-click notes from any block, saved to a topic folder.</p>
        </div>
        <div>
          <span className="tag green">04 · teach back</span>
          <p style={{ marginTop: 8 }}>Explain it to the Pupil. Gaps turn red and link back to the lesson.</p>
        </div>
      </div>

      {folders.length > 0 && (
        <section style={{ marginTop: 48 }}>
          <h2>Your topic folders</h2>
          <div className="stack">
            {folders.map((f) => {
              const last = f.scores[f.scores.length - 1];
              return (
                <div key={f.slug} className="row">
                  <Link className="folder" style={{ flex: 1 }} href={`/study?topic=${encodeURIComponent(folderTopic(f))}`}>
                    <strong style={{ flex: 1 }}>{f.topic}</strong>
                    <span className="tag">{f.notes.length} notes</span>
                    {last && <span className={`tag ${last.score >= 70 ? "green" : "red"}`}>last teach-back {last.score}%</span>}
                  </Link>
                  <button
                    className="btn ghost sm"
                    aria-label={`Delete ${f.topic}`}
                    onClick={() => {
                      deleteFolder(f.slug);
                      setFolders(listFolders());
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
