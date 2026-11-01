/**
 * Agent 1 — The Coursework & Repo Archivist.
 * Owns the knowledge base: retrieves grounded chunks for other agents, writes
 * the hidden ground-truth rubric for the Pupil, and extracts short notes.
 */
import { completeJSON, isMock } from "@/lib/llm";
import { contextPool, retrieve, tokenize, type Chunk } from "@/lib/retrieval";
import {
  NoteDraft,
  Rubric,
  type ExtraDoc,
  type Grounding,
  type LessonDraft,
  type LessonBlock,
  type RubricItem,
} from "@/lib/schemas";
import { tcpRubric } from "@/lib/fixtures/tcp";

export interface Context {
  chunks: Chunk[];
  /** True when the corpus (repos + web + uploads) has little or nothing on this topic. */
  weak: boolean;
  grounding: Grounding;
  /** This request's uploads + web chunks; pass to getChunks() to resolve cited ids. */
  pool: Chunk[];
}

/**
 * Retrieve grounded chunks for a topic. `query` lets callers focus retrieval
 * (e.g. on one block's title) while web search still runs on the topic, so
 * chunk ids stay stable across the lesson, disputes and reimagine requests.
 */
export async function gatherContext(topic: string, extra: ExtraDoc[] = [], k = 10, query?: string): Promise<Context> {
  // Offline demo stays offline: no web search in mock mode.
  const pool = await contextPool(topic, extra, { web: !isMock() });
  const hits = retrieve(query ?? topic, k, pool);
  const top = hits[0]?.score ?? 0;
  // Keep chunks that are reasonably close to the best hit.
  const chunks = hits.filter((h) => h.score >= top * 0.25).map((h) => h.chunk);
  const weak = chunks.length < 2 || top < 4;
  return { chunks, weak, grounding: weak ? "assisted" : "sources", pool };
}

/** Render chunks for a prompt. Agents cite by the bracketed id. */
export function formatContext(chunks: Chunk[]): string {
  if (!chunks.length) return "(no trusted sources were found for this topic)";
  return chunks
    .map((c) => `[${c.id}] (${c.label})\n${c.text.slice(0, 1400)}`)
    .join("\n\n---\n\n");
}

export const GROUNDING_RULES = `Grounding rules:
- Use ONLY facts supported by the SOURCES below. If the sources do not cover something, leave it out rather than guessing.
- Cite sources with their exact bracketed ids (e.g. "seed:foo#bar") in "sourceIds". Never invent ids or URLs.
- Prefer the wording and conventions of the sources over generic summaries.`;

const ASSISTED_RULES = `Grounding rules (sources are THIN for this topic):
- Use the SOURCES below wherever they apply, and cite them with their exact bracketed ids in "sourceIds".
- Where the sources do not cover something essential, you MAY use well-established, mainstream technical knowledge.
  Any block that relies on such knowledge must have an EMPTY "sourceIds" array; never cite a source that does not support the block.
- Never invent ids, URLs, quotes, version numbers, benchmarks or statistics. Prefer conservative, widely agreed facts.`;

export function groundingRules(g: Grounding): string {
  return g === "assisted" ? ASSISTED_RULES : GROUNDING_RULES;
}

/* ---------------- rubric ---------------- */

const RUBRIC_SYSTEM = `You are the Archivist agent of a learning platform. You write the HIDDEN grading rubric a "Pupil" agent will use to judge whether a learner can explain a topic in their own words (Feynman technique).

Return JSON: {"items": RubricItem[]} with 5-7 items, where RubricItem is
{"id": "r-<kebab>", "concept": string (<= 8 words), "expectation": string (what a correct explanation must contain, 1-2 sentences, grounded in sources),
 "keywords": string[] (3-8 lowercase words/phrases a correct explanation would likely use; include synonyms),
 "tier": "easy" | "medium" | "difficult", "blockId": string (id of the lesson block that teaches it)}.
Tiers: easy = definitions, purpose, basic flow. medium = mechanisms and "what happens if". difficult = edge cases, scale, trade-offs.
Include at least 2 easy, 2 medium and 1 difficult item. blockId MUST be one of the lesson block ids provided.`;

export async function buildRubric(
  topic: string,
  lesson: LessonDraft,
  chunks: Chunk[],
  grounding: Grounding = "sources",
): Promise<RubricItem[]> {
  if (!lesson.blocks.length) throw new Error("Cannot write a rubric for a lesson with no blocks");
  const valid = new Set(lesson.blocks.map((b) => b.id));
  // Lessons can be trimmed (length / interactivity options), so re-point items at blocks that exist.
  const fixBlockId = (id: string) => (valid.has(id) ? id : lesson.blocks[0].id);
  if (isMock()) return tcpRubric.map(({ misconceptions: _m, ...item }) => ({ ...item, blockId: fixBlockId(item.blockId) }));
  const blocks = lesson.blocks.map((b) => `- ${b.id} (${b.type}): ${b.title}`).join("\n");
  try {
    const out = await completeJSON(
      {
        tag: "archivist.rubric",
        system: `${RUBRIC_SYSTEM}\n${groundingRules(grounding)}`,
        maxTokens: 2000,
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content: `TOPIC: ${topic}\n\nLESSON BLOCKS:\n${blocks}\n\nSOURCES:\n${formatContext(chunks)}`,
          },
        ],
      },
      Rubric,
    );
    // Statuses are keyed by item id, so duplicates would share (and overwrite) one status.
    const seen = new Set<string>();
    return out.items.map((it) => {
      let id = it.id;
      for (let n = 2; seen.has(id); n++) id = `${it.id.slice(0, 60)}-${n}`;
      seen.add(id);
      return { ...it, id, keywords: it.keywords.map((k) => k.toLowerCase()), blockId: fixBlockId(it.blockId) };
    });
  } catch (e) {
    // The lesson is already built; a plainer rubric beats failing the whole request.
    console.warn("[archivist] rubric fallback:", (e as Error).message);
    return fallbackRubric(lesson);
  }
}

/** The single main claim of a block, for the deterministic fallback rubric. */
function mainClaim(b: LessonBlock): string {
  switch (b.type) {
    case "concept":
      return b.keyPoints[0] ?? b.body;
    case "slider":
      return b.insight;
    case "stepper":
    case "architecture":
      return b.description;
    case "code":
      return b.trace.map((t) => t.note).join(" ");
    case "predict":
      return `${b.options[b.correctIndex]}. ${b.explanation}`;
  }
}

/** Deterministic rubric (one item per block, up to 7) used when the LLM rubric fails. */
export function fallbackRubric(lesson: LessonDraft): RubricItem[] {
  const picked = lesson.blocks.slice(0, 7);
  return picked.map((b, i) => {
    const claim = mainClaim(b).replace(/[*`#>]/g, "").replace(/\s+/g, " ").trim();
    const sentence = (claim.match(/^.+?[.!?](\s|$)/)?.[0] ?? claim).trim();
    const keywords = [...new Set(tokenize(`${b.title} ${sentence}`).filter((t) => t.length > 3 && t.length <= 40))].slice(0, 6);
    const tier = i < Math.ceil(picked.length / 3) ? "easy" : i < picked.length - 1 || picked.length < 3 ? "medium" : "difficult";
    return {
      id: `r-${b.id}`.slice(0, 64),
      concept: b.title,
      expectation: `Explain in your own words: ${sentence || b.title}`.slice(0, 500),
      keywords: keywords.length ? keywords : [b.title.toLowerCase().slice(0, 40)],
      tier,
      blockId: b.id,
    };
  });
}

/* ---------------- notes ---------------- */

export interface NoteRequest {
  topic: string;
  block: LessonBlock;
  /** Live widget state at capture time (slider values, current step...). */
  state?: Record<string, unknown>;
  /** A specific diagram node / edge / step the learner captured. */
  focus?: { title: string; detail: string };
}

function fmtState(state?: Record<string, unknown>): string {
  if (!state || !Object.keys(state).length) return "";
  return Object.entries(state)
    .map(([k, v]) => `- ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("\n");
}

/** Fast, deterministic extraction used in mock mode and as a fallback. */
export function deterministicNote({ block, state, focus }: NoteRequest): NoteDraft {
  const lines: string[] = [];
  if (focus) {
    lines.push(focus.detail);
    lines.push("", `_From: ${block.title}_`);
    return { title: focus.title.slice(0, 200), markdown: lines.join("\n") };
  }
  switch (block.type) {
    case "concept":
      lines.push(...(block.keyPoints.length ? block.keyPoints.map((k) => `- ${k}`) : [block.body]));
      if (block.analogy) lines.push("", `> Analogy: ${block.analogy}`);
      break;
    case "slider":
      lines.push(block.insight, "", "**Formulas**");
      lines.push(...block.outputs.map((o) => `- ${o.label} = \`${o.expr}\``));
      break;
    case "stepper":
      for (const sc of block.scenarios) {
        lines.push(`**${sc.label}**`);
        sc.steps.forEach((s, i) => lines.push(`${i + 1}. ${s.label}: ${s.detail.split(". ")[0]}.`));
        lines.push("");
      }
      break;
    case "architecture":
      lines.push(block.description, "");
      lines.push(...block.nodes.map((n) => `- **${n.label}**: ${n.detail.split(". ")[0]}.`));
      break;
    case "code":
      lines.push(...block.trace.map((t) => `- L${t.line}: ${t.note}`));
      break;
    case "predict":
      lines.push(`**Q:** ${block.question}`, `**A:** ${block.options[block.correctIndex]}`, "", block.explanation);
      break;
  }
  const st = fmtState(state);
  if (st) lines.push("", "**Widget state when captured**", st);
  return { title: block.title, markdown: lines.join("\n").trim() };
}

const NOTE_SYSTEM = `You are the Archivist agent. Turn one interactive lesson block into a concise study note.
Return JSON {"title": string, "markdown": string}. The markdown is 3-8 short bullet points or numbered steps, max ~120 words,
using **bold** for key terms and \`code\` for identifiers/numbers. If widget state is given, add one line interpreting it
(e.g. "At RTT=200 ms the first byte takes 400 ms"). No preamble, no headings.`;

export async function extractNote(req: NoteRequest): Promise<NoteDraft> {
  if (isMock()) return deterministicNote(req);
  try {
    const payload = {
      block: req.block,
      focus: req.focus ?? null,
      state: req.state ?? null,
    };
    return await completeJSON(
      {
        tag: "archivist.note",
        system: NOTE_SYSTEM,
        maxTokens: 700,
        temperature: 0.2,
        messages: [{ role: "user", content: `TOPIC: ${req.topic}\n\n${JSON.stringify(payload).slice(0, 8000)}` }],
      },
      NoteDraft,
      1,
    );
  } catch (e) {
    console.warn("[archivist] note fallback:", (e as Error).message);
    return deterministicNote(req);
  }
}
