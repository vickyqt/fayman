/**
 * Knowledge base used by Agent 1 (Archivist).
 *
 * Sources, in priority order:
 *   1. data/corpus.json   – trusted GitHub repos pulled by `npm run ingest`
 *   2. content/seed/*.md  – small curated seed notes (offline demo)
 *   3. web (Wikipedia)    – searched per topic so ANY topic has sources (./web.ts)
 *   4. extra docs         – markdown/text the learner uploads (per request, stateless)
 *
 * 1–2 form the cached base index. 3–4 form a per-request "pool" that is merged
 * into the same BM25 index (cached by pool signature).
 *
 * Documents are split on markdown headings so every chunk has a deep link
 * (repo file + heading anchor) that becomes a citation badge in the UI.
 * Ranking is BM25: deterministic, zero-dependency, works offline. To use
 * embeddings instead, replace `search()`; the Chunk contract stays the same.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ExtraDoc } from "@/lib/schemas";
import { webDocs } from "./web";

export interface SourceDoc {
  docId: string;
  title: string;
  repo: string;
  path: string;
  url: string;
  text: string;
  /** How heading anchors are spelled in `url` (default: GitHub's slugs). */
  anchorStyle?: "github" | "wikipedia";
}

export interface Chunk {
  id: string;
  docId: string;
  heading: string;
  label: string;
  url: string;
  text: string;
  origin: "github" | "seed" | "web" | "upload";
}

export function githubSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const SOURCE_COMMENT = /<!--\s*source:\s*(\S+)\s*-->/;
const MAX_CHUNK = 1600;

export function chunkDoc(doc: SourceDoc, origin: Chunk["origin"]): Chunk[] {
  const lines = doc.text.replace(/\r/g, "").split("\n");
  const sections: { heading: string; body: string[] }[] = [{ heading: doc.title, body: [] }];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^#{1,4}\s+(.+?)\s*#*\s*$/);
    if (h) sections.push({ heading: h[1], body: [] });
    else sections[sections.length - 1].body.push(line);
  }

  const chunks: Chunk[] = [];
  const seen = new Map<string, number>();
  sections.forEach((s, si) => {
    const body = s.body.join("\n").trim();
    if (body.length < 40) return;
    let slug = githubSlug(s.heading);
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    if (n > 0) slug = `${slug}-${n}`;

    const override = body.match(SOURCE_COMMENT)?.[1];
    const anchor =
      doc.anchorStyle === "wikipedia" ? encodeURIComponent(s.heading.trim().replace(/ /g, "_")) : slug;
    // The lead section (before any heading) has no anchor of its own.
    const url = override ?? (doc.url ? (si === 0 ? doc.url : `${doc.url}#${anchor}`) : "");
    const clean = body.replace(SOURCE_COMMENT, "").trim();

    // Split oversized sections on paragraph boundaries.
    const parts: string[] = [];
    let buf = "";
    for (const para of clean.split(/\n{2,}/)) {
      if (buf && buf.length + para.length > MAX_CHUNK) {
        parts.push(buf);
        buf = "";
      }
      buf += (buf ? "\n\n" : "") + para;
    }
    if (buf) parts.push(buf);

    parts.forEach((text, i) => {
      chunks.push({
        id: `${doc.docId}#${slug}${parts.length > 1 ? `~${i + 1}` : ""}`,
        docId: doc.docId,
        heading: s.heading,
        label: `${
          origin === "upload" ? doc.title : origin === "seed" ? doc.repo : origin === "web" ? `${doc.repo}: ${doc.title}` : `${doc.repo}/${doc.path}`
        }${si === 0 && origin === "web" ? "" : ` › ${s.heading}`}`,
        url,
        text: text.slice(0, MAX_CHUNK * 1.5),
        origin,
      });
    });
  });
  return chunks;
}

function parseFrontmatter(input: string): { meta: Record<string, string>; body: string } {
  // Normalise line endings first: Windows checkouts (core.autocrlf) give CRLF files,
  // and an unmatched frontmatter would become a junk chunk at the top of the index.
  const raw = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

/* ---------------- BM25 ---------------- */

const STOP = new Set(
  "a an and are as at be by for from has have how in is it its of on or that the this to was what when where which why will with you your we our can do does".split(" "),
);

export function tokenize(text: string): string[] {
  // Unicode letters, so non-English Wikipedia editions (WEB_SEARCH_LANG) tokenize properly.
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_+.-]*/gu) ?? [])
    .map((t) => t.replace(/[.-]+$/, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

class BM25 {
  private docs: { chunk: Chunk; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avg = 1;

  constructor(chunks: Chunk[]) {
    for (const chunk of chunks) {
      const toks = tokenize(`${chunk.heading} ${chunk.heading} ${chunk.text}`);
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ chunk, tf, len: toks.length });
    }
    this.avg = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }

  search(query: string, k: number): { chunk: Chunk; score: number }[] {
    const q = [...new Set(tokenize(query))];
    const N = this.docs.length;
    const k1 = 1.4;
    const b = 0.75;
    return this.docs
      .map((d) => {
        let score = 0;
        for (const t of q) {
          const f = d.tf.get(t);
          if (!f) continue;
          const df = this.df.get(t) ?? 0;
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / this.avg)));
        }
        return { chunk: d.chunk, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, k);
  }
}

/* ---------------- corpus loading ---------------- */

let cached: { chunks: Chunk[]; index: BM25; stats: CorpusStats } | null = null;

export interface CorpusStats {
  seedDocs: number;
  githubDocs: number;
  chunks: number;
  repos: string[];
}

function loadBase() {
  if (cached) return cached;
  const root = process.cwd();
  const chunks: Chunk[] = [];
  let seedDocs = 0;
  let githubDocs = 0;
  const repos = new Set<string>();

  const ingested = path.join(root, "data", "corpus.json");
  if (fs.existsSync(ingested)) {
    try {
      const docs = JSON.parse(fs.readFileSync(ingested, "utf8")) as SourceDoc[];
      for (const d of docs) {
        chunks.push(...chunkDoc(d, "github"));
        repos.add(d.repo);
      }
      githubDocs = docs.length;
    } catch (e) {
      console.warn("[retrieval] could not read data/corpus.json:", (e as Error).message);
    }
  }

  const seedDir = path.join(root, "content", "seed");
  if (fs.existsSync(seedDir)) {
    for (const f of fs.readdirSync(seedDir).filter((x) => x.endsWith(".md"))) {
      const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(seedDir, f), "utf8"));
      const docId = `seed:${f.replace(/\.md$/, "")}`;
      chunks.push(
        ...chunkDoc(
          { docId, title: meta.title ?? f, repo: meta.repo ?? "seed", path: f, url: meta.url ?? "", text: body },
          "seed",
        ),
      );
      seedDocs++;
      if (meta.repo) repos.add(meta.repo);
    }
  }

  cached = {
    chunks,
    index: new BM25(chunks),
    stats: { seedDocs, githubDocs, chunks: chunks.length, repos: [...repos] },
  };
  return cached;
}

export function corpusStats(): CorpusStats {
  return loadBase().stats;
}

/**
 * Upload chunk ids are derived from the file name (not its position), so
 * citations stay valid if the learner adds or removes other uploads later.
 */
export function uploadChunks(extra: ExtraDoc[] = []): Chunk[] {
  const used = new Map<string, number>();
  return extra.flatMap((d) => {
    let slug = githubSlug(d.name.replace(/\.[a-z0-9]+$/i, "")) || "file";
    const n = used.get(slug) ?? 0;
    used.set(slug, n + 1);
    if (n > 0) slug = `${slug}-${n}`;
    return chunkDoc({ docId: `upload:${slug}`, title: d.name, repo: "upload", path: d.name, url: "", text: d.text }, "upload");
  });
}

/**
 * Per-request extra chunks: the learner's uploads plus web results for the
 * topic. Pass the returned pool to retrieve() and getChunks().
 */
export async function contextPool(topic: string, extra: ExtraDoc[] = [], opts: { web?: boolean } = {}): Promise<Chunk[]> {
  const web = opts.web === false ? [] : await webDocs(topic);
  return [...uploadChunks(extra), ...web.flatMap((d) => chunkDoc(d, "web"))];
}

const merged = new Map<string, BM25>();

function indexFor(pool: Chunk[]): BM25 {
  const base = loadBase();
  if (!pool.length) return base.index;
  const sig = crypto
    .createHash("sha1")
    .update(pool.map((c) => `${c.id}:${c.text.length}`).join("|"))
    .digest("hex");
  let idx = merged.get(sig);
  if (!idx) {
    idx = new BM25([...base.chunks, ...pool]);
    if (merged.size >= 16) merged.delete(merged.keys().next().value as string);
    merged.set(sig, idx);
  }
  return idx;
}

/**
 * Retrieve the top-k chunks for a query. Uploads and web pages are ranked in
 * the same index so they can outrank (but never replace) trusted repos.
 */
export function retrieve(query: string, k = 8, pool: Chunk[] = []): { chunk: Chunk; score: number }[] {
  return indexFor(pool).search(query, k);
}

/** Lookup table used by the guardrail to turn chunk ids into citations. */
export function chunkMap(chunks: Chunk[]): Map<string, Chunk> {
  return new Map(chunks.map((c) => [c.id, c]));
}

/** Fetch specific chunks by id from the base corpus (+ the request's pool). */
export function getChunks(ids: string[], pool: Chunk[] = []): Chunk[] {
  if (!ids.length) return [];
  const map = chunkMap([...loadBase().chunks, ...pool]);
  return ids.map((id) => map.get(id)).filter((c): c is Chunk => !!c);
}
