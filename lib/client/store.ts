"use client";
/**
 * Per-learner persistence in localStorage: topic folders hold notes,
 * teach-back scores and the last lesson session. Everything is wrapped in
 * try/catch so private windows and blocked storage degrade gracefully.
 */
import type {
  Difficulty,
  ExtraDoc,
  GuardedBlock,
  Lesson,
  LearnerProfile,
  LessonOptions,
  RubricItem,
  RubricStatus,
  TranscriptMsg,
  Scorecard,
} from "@/lib/schemas";
import { DEFAULT_OPTIONS, withDefaults } from "@/lib/lesson-options";
import { LIMITS } from "@/lib/limits";

export interface Note {
  id: string;
  blockId: string;
  title: string;
  markdown: string;
  snapshot?: Record<string, unknown>;
  createdAt: string;
}

export interface ScoreEntry {
  at: string;
  difficulty: Difficulty;
  score: number;
  mastered: string[];
  gaps: string[];
}

export interface Session {
  topic: string;
  profile: LearnerProfile;
  lesson: Lesson;
  rubric: RubricItem[];
  sources: { id: string; label: string; url: string; origin: string }[];
  guardReport?: unknown;
  teach?: {
    difficulty: Difficulty;
    transcript: TranscriptMsg[];
    statuses: Record<string, { status: RubricStatus; evidence?: string }>;
    scorecard?: Scorecard;
  };
  /** Earlier versions of reimagined / regenerated blocks, newest last (for Undo). */
  revisions?: Record<string, GuardedBlock[]>;
  /** The lesson before the last whole-lesson reimagine (for Undo). */
  previous?: { lesson: Lesson; rubric: RubricItem[]; sources: Session["sources"]; teach?: Session["teach"] };
  /** The learner dismissed the "make it yours" hint. */
  hintDismissed?: boolean;
}

export interface Folder {
  slug: string;
  topic: string;
  notes: Note[];
  scores: ScoreEntry[];
  updatedAt: string;
}

const P = "feynman-lab:";

export function slugify(topic: string): string {
  return topic.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "topic";
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(P + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(P + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: keep working in memory */
  }
}

export function listFolders(): Folder[] {
  const slugs = read<string[]>("folders", []);
  return slugs
    .map((s) => read<Folder | null>(`folder:${s}`, null))
    .filter((f): f is Folder => !!f)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The topic to open a folder with. It must slugify back to the folder's slug;
 * older versions saved the offline demo's lesson title instead, so fall back to
 * the slug itself for those.
 */
export function folderTopic(f: Folder): string {
  return slugify(f.topic) === f.slug ? f.topic : f.slug.replace(/-/g, " ");
}

export function getFolder(topic: string): Folder {
  const slug = slugify(topic);
  return read<Folder>(`folder:${slug}`, { slug, topic, notes: [], scores: [], updatedAt: new Date().toISOString() });
}

export function saveFolder(f: Folder) {
  f.updatedAt = new Date().toISOString();
  write(`folder:${f.slug}`, f);
  const slugs = read<string[]>("folders", []);
  if (!slugs.includes(f.slug)) write("folders", [...slugs, f.slug]);
}

export function deleteFolder(slug: string) {
  try {
    localStorage.removeItem(P + `folder:${slug}`);
    localStorage.removeItem(P + `session:${slug}`);
  } catch {}
  write("folders", read<string[]>("folders", []).filter((s) => s !== slug));
}

export function getSession(topic: string): Session | null {
  const s = read<Session | null>(`session:${slugify(topic)}`, null);
  if (!s?.lesson?.blocks) return null;
  // Sessions saved before lesson options existed.
  s.lesson.options = withDefaults(s.lesson.options);
  s.lesson.depth ??= s.profile?.depth ?? "mechanisms";
  s.lesson.grounding ??= "sources";
  return s;
}
export function saveSession(s: Session) {
  write(`session:${slugify(s.topic)}`, s);
}
export function clearSession(topic: string) {
  try {
    localStorage.removeItem(P + `session:${slugify(topic)}`);
  } catch {}
}

/* lesson option preferences (pre-fill the picker next time) */
export function getPrefs(): LessonOptions {
  return withDefaults(read<Partial<LessonOptions>>("prefs", DEFAULT_OPTIONS));
}
export function setPrefs(o: LessonOptions) {
  write("prefs", o);
}

/* uploaded study material (kept for the browser session) */
export function getUploads(): ExtraDoc[] {
  try {
    const docs: unknown = JSON.parse(sessionStorage.getItem(P + "uploads") || "[]");
    if (!Array.isArray(docs)) return [];
    // Never send more than the server accepts (older versions stored unlimited uploads).
    return docs
      .filter((d): d is ExtraDoc => typeof d?.name === "string" && typeof d?.text === "string")
      .slice(0, LIMITS.uploads)
      .map((d) => ({ name: d.name.slice(0, 200), text: d.text.slice(0, LIMITS.uploadChars) }));
  } catch {
    return [];
  }
}
export function setUploads(docs: ExtraDoc[]) {
  try {
    sessionStorage.setItem(P + "uploads", JSON.stringify(docs));
  } catch {}
}

/* export */
export function folderToMarkdown(f: Folder): string {
  const out = [`# ${f.topic} — study sheet`, "", `_Exported ${new Date().toLocaleString()}_`, ""];
  if (f.scores.length) {
    out.push("## Teach-back scores", "");
    for (const s of f.scores) {
      out.push(`- **${s.score}%** (${s.difficulty}, ${new Date(s.at).toLocaleDateString()})`);
      if (s.gaps.length) out.push(`  - Review: ${s.gaps.join(", ")}`);
    }
    out.push("");
  }
  out.push("## Notes", "");
  for (const n of f.notes) {
    out.push(`### ${n.title}`, "", n.markdown, "");
    if (n.snapshot && Object.keys(n.snapshot).length) {
      out.push("```json", JSON.stringify(n.snapshot, null, 2), "```", "");
    }
  }
  return out.join("\n");
}

export function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
