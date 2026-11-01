"use client";
import { useEffect, useState } from "react";
import { Markdown } from "@/lib/client/md";
import type { Folder, Note } from "@/lib/client/store";

export interface Draft {
  blockId: string;
  loading: boolean;
  title: string;
  markdown: string;
  snapshot?: Record<string, unknown>;
  error?: string;
}

export function NotesDrawer({
  folder,
  draft,
  onSave,
  onDiscard,
  onDelete,
  onUpdate,
  onExport,
  onJump,
  onClose,
}: {
  folder: Folder;
  draft: Draft | null;
  onSave: (d: Draft, attachSnapshot: boolean) => void;
  onDiscard: () => void;
  onDelete: (id: string) => void;
  onUpdate: (n: Note) => void;
  onExport: () => void;
  onJump: (blockId: string) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<Draft | null>(draft);
  const [attach, setAttach] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  useEffect(() => {
    setLocal(draft);
  }, [draft]);

  return (
    <aside className="drawer" aria-label="Notes">
      <div className="drawer-head">
        <strong>Notes</strong>
        <span className="tag">{folder.notes.length}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={onExport} disabled={!folder.notes.length && !folder.scores.length}>
          Export .md
        </button>
        <button className="btn ghost sm" onClick={onClose} aria-label="Close notes">
          ✕
        </button>
      </div>
      <div className="drawer-body">
        {local && (
          <div className="note" style={{ borderColor: "var(--blue)", boxShadow: "3px 3px 0 var(--blue)" }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="tag blue">Agent 1 · new note</span>
            </div>
            {local.loading ? (
              <p className="small muted">Extracting a short note from this block…</p>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {local.error && <div className="warn small">{local.error}</div>}
                <input className="input" value={local.title} onChange={(e) => setLocal({ ...local, title: e.target.value })} aria-label="Note title" />
                <textarea
                  className="textarea"
                  value={local.markdown}
                  rows={8}
                  onChange={(e) => setLocal({ ...local, markdown: e.target.value })}
                  aria-label="Note markdown"
                />
                {local.snapshot && Object.keys(local.snapshot).length > 0 && (
                  <>
                    <label className="small row" style={{ gap: 6 }}>
                      <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> Attach widget snapshot
                    </label>
                    {attach && <div className="snapshot">{JSON.stringify(local.snapshot, null, 1)}</div>}
                  </>
                )}
                <div className="row">
                  <button className="btn sm green" onClick={() => onSave(local, attach)}>
                    Save to “{folder.topic}”
                  </button>
                  <button className="btn sm" onClick={onDiscard}>
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!local && !folder.notes.length && (
          <p className="small muted">
            Press <strong>＋ Capture to notes</strong> on any block, diagram state or step. A short, editable summary lands here without
            leaving the lesson.
          </p>
        )}

        {[...folder.notes].reverse().map((n) => (
          <div className="note" key={n.id}>
            <div className="row">
              <h4 style={{ flex: 1 }}>{n.title}</h4>
              <button className="btn ghost sm" onClick={() => onJump(n.blockId)} title="Scroll to block">
                ↖
              </button>
              <button
                className="btn ghost sm"
                onClick={() => {
                  setEditing(n.id);
                  setEditText(n.markdown);
                }}
              >
                Edit
              </button>
              <button className="btn ghost sm" onClick={() => onDelete(n.id)} aria-label="Delete note">
                ✕
              </button>
            </div>
            {editing === n.id ? (
              <div className="stack" style={{ gap: 6 }}>
                <textarea className="textarea" value={editText} onChange={(e) => setEditText(e.target.value)} rows={7} />
                <div className="row">
                  <button
                    className="btn sm green"
                    onClick={() => {
                      onUpdate({ ...n, markdown: editText });
                      setEditing(null);
                    }}
                  >
                    Save
                  </button>
                  <button className="btn sm" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="small">
                <Markdown text={n.markdown} />
              </div>
            )}
            {n.snapshot && Object.keys(n.snapshot).length > 0 && editing !== n.id && (
              <details>
                <summary className="small muted">Widget snapshot</summary>
                <div className="snapshot">{JSON.stringify(n.snapshot, null, 1)}</div>
              </details>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
