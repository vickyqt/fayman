/**
 * Agent 5 — The Curriculum & Consumer Compliance Manager.
 *
 *  - Schema & UI compliance: deterministic structural checks/repairs on every
 *    block (formulas compile, edges reference real nodes, indexes in range...).
 *    Colors can't leak in: the schema has no color fields and zod strips
 *    unknown keys, so only semantic "status" values reach the renderer.
 *  - Source fidelity: citations are resolved from chunk ids (models can't
 *    invent URLs), then an LLM pass checks each block's claims against the
 *    cited text; unsupported blocks are regenerated once, else flagged.
 *  - Pupil audit: drops rubric updates that cite words the learner never said.
 *  - Dispute resolution: audits learner flags, regenerates blocks or
 *    recalibrates rubric items, and logs every decision.
 */
import fs from "node:fs";
import path from "node:path";
import { completeJSON, isMock, timeLeft } from "@/lib/llm";
import { checkExpr } from "@/lib/expr";
import { chunkMap, tokenize, type Chunk } from "@/lib/retrieval";
import {
  DisputeVerdict,
  FidelityReport,
  LessonBlock,
  type GuardedBlock,
  type Grounding,
  type LessonDraft,
  type PupilTurn,
  type RubricItem,
  type TranscriptMsg,
} from "@/lib/schemas";
import { regenerateBlock } from "./architect";
import { keywordGrade, type StatusMap } from "./pupil";
import { formatContext } from "./archivist";

/* ---------------- structural compliance ---------------- */

interface Check {
  block: LessonBlock | null; // null = unrecoverable, drop it
  issues: string[];
  repaired: boolean;
}

export function checkBlock(input: LessonBlock): Check {
  const block = structuredClone(input) as LessonBlock;
  const issues: string[] = [];
  let repaired = false;
  const fix = (msg: string) => {
    issues.push(msg);
    repaired = true;
  };

  switch (block.type) {
    case "slider": {
      const env: Record<string, number> = {};
      const names = new Set<string>();
      block.params = block.params.filter((p) => {
        if (names.has(p.name)) return fix(`Duplicate param "${p.name}" removed`), false;
        names.add(p.name);
        if (p.min >= p.max) return fix(`Param "${p.name}" has min >= max; removed`), false;
        if (p.default < p.min || p.default > p.max) {
          p.default = Math.min(p.max, Math.max(p.min, p.default));
          fix(`Param "${p.name}" default clamped into range`);
        }
        if (p.step > p.max - p.min) {
          p.step = (p.max - p.min) / 10;
          fix(`Param "${p.name}" step too large; adjusted`);
        }
        env[p.name] = p.default;
        return true;
      });
      block.outputs = block.outputs.filter((o) => {
        const err = checkExpr(o.expr, env);
        if (err) return fix(`Output "${o.label}" removed: ${err}`), false;
        for (const k of ["goodWhen", "badWhen"] as const) {
          const cond = o[k];
          if (cond && checkExpr(cond, env)) {
            fix(`Output "${o.label}" ${k} removed: ${checkExpr(cond, env)}`);
            o[k] = undefined;
          }
        }
        return true;
      });
      if (block.chart && (!names.has(block.chart.x) || block.chart.outputIndex >= block.outputs.length)) {
        block.chart = undefined;
        fix("Chart referenced a missing param/output; removed");
      }
      if (!block.params.length || !block.outputs.length) return { block: null, issues: [...issues, "Slider has no valid params/outputs"], repaired };
      break;
    }
    case "stepper": {
      const lanes = new Set(block.lanes.map((l) => l.id));
      block.scenarios = block.scenarios
        .map((sc) => ({
          ...sc,
          steps: sc.steps.filter((s) => {
            const ok = lanes.has(s.from) && lanes.has(s.to);
            if (!ok) fix(`Step "${s.label}" referenced an unknown lane; removed`);
            return ok;
          }),
        }))
        .filter((sc) => sc.steps.length > 0);
      if (!block.scenarios.length) return { block: null, issues: [...issues, "Stepper has no valid steps"], repaired };
      break;
    }
    case "architecture": {
      const seen = new Set<string>();
      block.nodes = block.nodes.filter((n) => (seen.has(n.id) ? (fix(`Duplicate node "${n.id}"`), false) : (seen.add(n.id), true)));
      block.edges = block.edges.filter((e) => {
        const ok = seen.has(e.source) && seen.has(e.target);
        if (!ok) fix(`Edge "${e.id}" referenced a missing node; removed`);
        return ok;
      });
      if (block.challenge) {
        block.challenge.requiredEdges = block.challenge.requiredEdges.filter((r) => seen.has(r.source) && seen.has(r.target));
        const req = new Set(block.challenge.requiredEdges.map((r) => `${r.source}>${r.target}`));
        const before = block.edges.length;
        block.edges = block.edges.filter((e) => !req.has(`${e.source}>${e.target}`)); // must be drawn by learner
        if (block.edges.length !== before) fix("Challenge edges were pre-drawn; hidden so the learner draws them");
        if (!block.challenge.requiredEdges.length) {
          block.challenge = undefined;
          fix("Challenge had no valid edges; removed");
        }
      }
      // Accessibility: spread nodes that overlap so labels stay readable. A moved node is
      // re-checked against every node already placed, so a nudge can't create a new overlap.
      const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.abs(a.x - b.x) < 150 && Math.abs(a.y - b.y) < 60;
      for (let i = 1; i < block.nodes.length; i++) {
        const a = block.nodes[i];
        for (let tries = 0; tries < block.nodes.length; tries++) {
          const hit = block.nodes.slice(0, i).find((b) => overlaps(a, b));
          if (!hit) break;
          a.y = hit.y + 90;
          repaired = true;
        }
      }
      if (block.nodes.length < 2) return { block: null, issues: [...issues, "Diagram has fewer than 2 nodes"], repaired };
      break;
    }
    case "code": {
      const lines = block.code.split("\n").length;
      block.trace = block.trace.filter((t) => (t.line <= lines ? true : (fix(`Trace step on line ${t.line} is past the end; removed`), false)));
      if (!block.trace.length) return { block: null, issues: [...issues, "Code trace is empty"], repaired };
      break;
    }
    case "predict": {
      if (block.correctIndex >= block.options.length) return { block: null, issues: ["Prediction answer index out of range"], repaired };
      break;
    }
    case "concept":
      if (!block.narration) block.narration = block.body.replace(/[*`#>-]/g, "").slice(0, 600);
      break;
  }
  return { block, issues, repaired };
}

function resolveCitations(block: LessonBlock, map: Map<string, Chunk>) {
  const citations = [];
  const unknown: string[] = [];
  for (const id of block.sourceIds) {
    const c = map.get(id);
    if (c) citations.push({ chunkId: c.id, label: c.label, url: c.url });
    else unknown.push(id);
  }
  return { citations, unknown };
}

/* ---------------- source fidelity ---------------- */

function blockClaims(b: LessonBlock): string {
  switch (b.type) {
    case "concept":
      return [b.body, b.analogy, ...b.keyPoints].filter(Boolean).join("\n");
    case "slider":
      return [b.description, b.insight, ...b.outputs.map((o) => `${o.label} = ${o.expr}`)].join("\n");
    case "stepper":
      return b.scenarios.flatMap((s) => s.steps.map((st) => `${st.label}: ${st.detail}`)).join("\n");
    case "architecture":
      return [b.description, ...b.nodes.map((n) => `${n.label}: ${n.detail}`), ...b.edges.map((e) => `${e.label ?? ""} ${e.detail ?? ""}`)].join("\n");
    case "code":
      return b.trace.map((t) => t.note).join("\n");
    case "predict":
      return `${b.question}\nAnswer: ${b.options[b.correctIndex]}\n${b.explanation}`;
  }
}

const FIDELITY_SYSTEM = `You are the source-fidelity auditor of a learning platform. For each lesson block, decide whether its technical claims
are supported by (or at least consistent with) the SOURCES. Flag only real problems: claims that CONTRADICT the sources, or specific
facts/numbers that appear nowhere in them. Simplifications, analogies and reasonable pedagogy are fine.
Return JSON {"blocks": [{"blockId", "supported": boolean, "issues": string[] (each names the problematic claim)}]} with one entry per block.`;

async function fidelityCheck(blocks: LessonBlock[], chunks: Chunk[]) {
  const payload = blocks.map((b) => ({ blockId: b.id, title: b.title, claims: blockClaims(b).slice(0, 1800) }));
  const report = await completeJSON(
    {
      tag: "guardrail.fidelity",
      system: FIDELITY_SYSTEM,
      maxTokens: 2000,
      temperature: 0,
      messages: [{ role: "user", content: `BLOCKS:\n${JSON.stringify(payload)}\n\nSOURCES:\n${formatContext(chunks)}` }],
    },
    FidelityReport,
    1,
  );
  return new Map(report.blocks.map((r) => [r.blockId, r]));
}

export interface GuardReport {
  checkedAt: string;
  dropped: { blockId: string; issues: string[] }[];
  repairedBlocks: number;
  regenerated: string[];
  unverified: string[];
  fidelityRan: boolean;
  weakSources: boolean;
  /** Optional LLM steps skipped so the request could finish inside its time budget. */
  skippedForTime: string[];
}

/**
 * Time the rest of a lesson request still needs after the guardrail (the rubric
 * call, plus headroom). Optional checks only start when they can finish first.
 */
const FIDELITY_NEEDS_MS = 75_000;
const REGEN_NEEDS_MS = 60_000;

/** Deduplicate a block id without breaking the 64-char id limit the API schemas enforce. */
function uniqueId(id: string, taken: Set<string>): string {
  if (!taken.has(id)) return id;
  for (let n = 2; ; n++) {
    const candidate = `${id.slice(0, 60)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function guardLesson(
  topic: string,
  draft: LessonDraft,
  chunks: Chunk[],
  weakSources: boolean,
): Promise<{ blocks: GuardedBlock[]; report: GuardReport }> {
  const map = chunkMap(chunks);
  const report: GuardReport = {
    checkedAt: new Date().toISOString(),
    dropped: [],
    repairedBlocks: 0,
    regenerated: [],
    unverified: [],
    fidelityRan: false,
    weakSources,
    skippedForTime: [],
  };

  // 1. unique ids + structural checks
  const ids = new Set<string>();
  const checked: { block: LessonBlock; issues: string[]; repaired: boolean }[] = [];
  for (const raw of draft.blocks) {
    const id = uniqueId(raw.id, ids);
    const b = id === raw.id ? raw : { ...raw, id };
    ids.add(b.id);
    const c = checkBlock(b);
    if (!c.block) {
      report.dropped.push({ blockId: b.id, issues: c.issues });
      continue;
    }
    if (c.repaired) report.repairedBlocks++;
    checked.push({ block: c.block, issues: c.issues, repaired: c.repaired });
  }

  const grounding: Grounding = weakSources ? "assisted" : "sources";

  // 2. fidelity (LLM) — skipped offline and when there are no sources to check against.
  // With thin sources, uncited blocks are knowingly model-written, so only cited blocks are audited.
  let fidelity: Awaited<ReturnType<typeof fidelityCheck>> | null = null;
  const auditable = checked.filter((c) => !weakSources || c.block.sourceIds.some((id) => map.has(id)));
  if (!isMock() && chunks.length && auditable.length) {
    if (timeLeft() < FIDELITY_NEEDS_MS) {
      report.skippedForTime.push("fidelity audit");
      console.warn("[guardrail] fidelity check skipped: not enough time left in this request");
    } else {
      try {
        fidelity = await fidelityCheck(auditable.map((c) => c.block), chunks);
        report.fidelityRan = true;
      } catch (e) {
        console.warn("[guardrail] fidelity check skipped:", (e as Error).message);
      }
    }
  }

  // 3. regenerate unsupported blocks once (in parallel), re-check them
  const canRegenerate = timeLeft() >= REGEN_NEEDS_MS;
  if (!canRegenerate && [...(fidelity?.values() ?? [])].some((f) => !f.supported)) report.skippedForTime.push("regeneration");
  await Promise.all(
    checked.map(async (c, i) => {
      const f = fidelity?.get(c.block.id);
      if (!f || f.supported) return;
      if (canRegenerate) {
        try {
          const regen = await regenerateBlock(topic, c.block, f.issues, chunks, grounding);
          const rc = checkBlock({ ...regen, id: c.block.id } as LessonBlock);
          if (rc.block) {
            checked[i] = { block: rc.block, issues: [`Regenerated after fidelity check: ${f.issues.join("; ")}`], repaired: true };
            report.regenerated.push(c.block.id);
            return;
          }
        } catch (e) {
          console.warn("[guardrail] regeneration failed:", (e as Error).message);
        }
      }
      c.issues.push(...f.issues.map((x) => `Possibly unsupported: ${x}`));
      (c as { unsupported?: boolean }).unsupported = true;
    }),
  );

  // 4. resolve citations and annotate
  const blocks: GuardedBlock[] = checked.map((c) => {
    const { citations, unknown } = resolveCitations(c.block, map);
    const issues = [...c.issues];
    if (unknown.length) issues.push(`Removed ${unknown.length} citation(s) to sources that were not retrieved`);
    const unsupported = (c as { unsupported?: boolean }).unsupported;
    let status: GuardedBlock["verification"]["status"] = "verified";
    if (!citations.length && weakSources) {
      issues.push("Written from the model's general knowledge: no retrieved source covers this section. Double-check key facts.");
      status = "model";
    } else if (!citations.length) {
      issues.push("No trusted source backs this block");
      status = "unverified";
    } else if (unsupported) status = "unverified";
    else if (c.repaired || unknown.length) status = "repaired";
    if (status === "unverified") report.unverified.push(c.block.id);
    return { ...c.block, citations, verification: { status, issues } };
  });

  return { blocks, report };
}

/** Guard one (re)generated block; null if it can't be salvaged. */
export async function guardSingle(topic: string, block: LessonBlock, chunks: Chunk[], weakSources: boolean): Promise<GuardedBlock | null> {
  const out = await guardLesson(topic, { title: "", summary: "", blocks: [block] as LessonDraft["blocks"] }, chunks, weakSources).catch(
    () => null,
  );
  return out?.blocks[0] ?? null;
}

/* ---------------- pupil audit ---------------- */

function overlap(evidence: string, learnerText: string): number {
  const ev = tokenize(evidence);
  if (!ev.length) return 0;
  const said = new Set(tokenize(learnerText));
  return ev.filter((t) => said.has(t)).length / ev.length;
}

/** The quoted part of an evidence string (`note ("learner words")`), or all of it when nothing is quoted. */
function quotedPart(evidence: string): string {
  const quotes = [...evidence.matchAll(/["“]([^"”]{8,})["”]/g)];
  return quotes.length ? quotes[quotes.length - 1][1] : evidence;
}

/**
 * Keeps the Pupil honest, in both directions:
 *  - a concept only turns green if the evidence is something the learner actually said;
 *  - a concept only turns red if the latest message really says something wrong (the
 *    quoted words are the learner's) or it dodged the question the Pupil just asked about it.
 * Unknown rubric ids are dropped.
 */
export function auditPupilTurn(turn: PupilTurn, items: RubricItem[], transcript: TranscriptMsg[]): PupilTurn {
  const valid = new Set(items.map((i) => i.id));
  const learnerText = transcript.filter((m) => m.role === "learner").map((m) => m.text).join("\n");
  const latest = [...transcript].reverse().find((m) => m.role === "learner")?.text ?? "";
  const lastLearner = transcript.map((m) => m.role).lastIndexOf("learner");
  const asked = [...transcript.slice(0, Math.max(0, lastLearner))].reverse().find((m) => m.role === "pupil")?.targetId;
  const updates = turn.updates.filter((u) => {
    if (!valid.has(u.id)) return false;
    if (u.status === "mastered" && overlap(u.evidence, learnerText) < 0.5) {
      console.warn(`[guardrail] dropped ungrounded mastery for ${u.id}: "${u.evidence}"`);
      return false;
    }
    if (u.status === "gap" && u.id !== asked && overlap(quotedPart(u.evidence), latest) < 0.5) {
      console.warn(`[guardrail] dropped ungrounded gap for ${u.id}: "${u.evidence}"`);
      return false;
    }
    return true;
  });
  const targetId = turn.targetId && valid.has(turn.targetId) ? turn.targetId : undefined;
  return { ...turn, targetId, updates };
}

/* ---------------- disputes ---------------- */

export interface DisputeInput {
  topic: string;
  kind: "block" | "grading";
  complaint: string;
  block?: LessonBlock;
  rubricItem?: RubricItem;
  currentStatus?: StatusMap[string];
  transcript?: TranscriptMsg[];
  extraChunks?: Chunk[];
}

export interface DisputeResult extends DisputeVerdict {
  block?: GuardedBlock;
  rubricItem?: RubricItem;
  logId: string;
}

function logDispute(entry: Record<string, unknown>) {
  try {
    const file = path.join(process.cwd(), "data", "disputes.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {
    // Read-only filesystems (serverless): the console log below is the record.
  }
  console.log("[guardrail] dispute", JSON.stringify(entry).slice(0, 500));
}

const DISPUTE_SYSTEM = `You are the learner-advocacy and quality agent. A learner flagged a problem. Audit it fairly: side with the learner
when the complaint is reasonable (unclear explanation, broken or confusing widget, unfair or overly strict grading, rubric expecting
something the lesson never taught), and reject it only when the original is correct and clear.
Return JSON {"verdict": "upheld"|"rejected", "explanation": string (addressed to the learner, 1-3 sentences),
 "action": "regenerate_block"|"recalibrate_rubric"|"none",
 "rubricPatch"?: {"id", "expectation", "keywords"} (when the rubric item itself was unfair or unclear),
 "regradeTo"?: "mastered"|"gap"|"pending" (for grading disputes, the fair status given the transcript)}.`;

/**
 * A verdict only changes something when it is upheld, and only in ways that fit
 * the dispute: a rejected flag never regrades or patches anything, a block flag
 * never touches grading, and a grading dispute never regenerates a block.
 */
export function normalizeVerdict(v: DisputeVerdict, kind: DisputeInput["kind"]): DisputeVerdict {
  if (v.verdict === "rejected") return { verdict: v.verdict, explanation: v.explanation, action: "none" };
  if (kind === "block") return { verdict: v.verdict, explanation: v.explanation, action: v.action === "regenerate_block" ? v.action : "none" };
  return {
    verdict: v.verdict,
    explanation: v.explanation,
    action: v.action === "regenerate_block" ? "none" : v.action,
    ...(v.rubricPatch ? { rubricPatch: v.rubricPatch } : {}),
    ...(v.regradeTo ? { regradeTo: v.regradeTo } : {}),
  };
}

export async function resolveDispute(input: DisputeInput, chunks: Chunk[], weakSources = false): Promise<DisputeResult> {
  const logId = `d_${Date.now().toString(36)}`;
  let verdict: DisputeVerdict;

  if (isMock()) {
    if (input.kind === "block") {
      verdict = {
        verdict: "upheld",
        action: "regenerate_block",
        explanation: "Thanks for flagging it. I rebuilt this block and re-ran the structural and citation checks.",
      };
    } else {
      const learnerText = (input.transcript ?? []).filter((m) => m.role === "learner").map((m) => m.text).join(" ");
      const g = input.rubricItem ? keywordGrade(input.rubricItem, learnerText, 1) : { pass: false, hits: [] as string[] };
      verdict = g.pass
        ? {
            verdict: "upheld",
            action: "recalibrate_rubric",
            regradeTo: "mastered",
            explanation: `You did mention ${g.hits.map((h) => `"${h}"`).join(", ")}. The grading was too strict, so I've marked it as explained.`,
          }
        : {
            verdict: "rejected",
            action: "none",
            explanation: `I re-read the conversation. To count, an explanation needs to cover: ${input.rubricItem?.expectation ?? "the concept"}`,
          };
    }
  } else {
    verdict = await completeJSON(
      {
        tag: "guardrail.dispute",
        system: DISPUTE_SYSTEM,
        maxTokens: 900,
        temperature: 0.1,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              topic: input.topic,
              kind: input.kind,
              complaint: input.complaint,
              block: input.block,
              rubricItem: input.rubricItem,
              currentStatus: input.currentStatus,
              transcript: input.transcript?.slice(-16),
            }).slice(0, 14000) + `\n\nSOURCES:\n${formatContext(chunks)}`,
          },
        ],
      },
      DisputeVerdict,
      1,
    );
  }

  verdict = normalizeVerdict(verdict, input.kind);
  const result: DisputeResult = { ...verdict, logId };

  if (verdict.action === "regenerate_block" && input.block) {
    const grounding: Grounding = weakSources ? "assisted" : "sources";
    const regen = await regenerateBlock(input.topic, input.block, [`Learner feedback: ${input.complaint}`], chunks, grounding);
    const guarded = await guardSingle(input.topic, { ...regen, id: input.block.id } as LessonBlock, chunks, weakSources);
    const block = guarded;
    if (block) {
      block.verification.issues.unshift(`Regenerated after learner flag: "${input.complaint.slice(0, 120)}"`);
      result.block = block;
    } else {
      result.explanation += " I couldn't produce a version that passed the quality checks, so the section is unchanged; try reimagining it with ✦.";
    }
  }
  if (input.rubricItem && verdict.rubricPatch && verdict.rubricPatch.id === input.rubricItem.id) {
    result.rubricItem = {
      ...input.rubricItem,
      expectation: verdict.rubricPatch.expectation,
      keywords: verdict.rubricPatch.keywords.map((k) => k.toLowerCase()),
    };
  }

  logDispute({
    id: logId,
    at: new Date().toISOString(),
    topic: input.topic,
    kind: input.kind,
    target: input.block?.id ?? input.rubricItem?.id,
    complaint: input.complaint,
    verdict: verdict.verdict,
    action: verdict.action,
    regradeTo: verdict.regradeTo,
  });
  return result;
}
