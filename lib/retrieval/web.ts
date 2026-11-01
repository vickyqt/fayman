/**
 * Open-web grounding for topics the trusted corpus doesn't cover.
 *
 * Searches Wikipedia (no API key, generous limits) and returns the top pages as
 * SourceDocs. Section headings become "##" markdown so chunkDoc() can split
 * them into citable, deep-linked chunks exactly like repo files. Results are
 * cached per topic, so follow-up calls (disputes, reimagine) see the same
 * chunk ids the lesson was built from.
 *
 *   WEB_SEARCH=off        disable (trusted corpus + uploads only)
 *   WEB_SEARCH_LANG=de    use another Wikipedia language edition
 */
import type { SourceDoc } from "./index";

const UA = "FeynmanLab/0.1 (educational learning app; https://github.com/)";
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PAGES = 3;
const MAX_CHARS = 60_000;
const SKIP_SECTIONS = /^(see also|references|external links|further reading|notes|bibliography|sources|citations|footnotes)$/i;

const cache = new Map<string, { at: number; docs: SourceDoc[] }>();

export function webSearchEnabled(): boolean {
  const v = (process.env.WEB_SEARCH ?? "on").toLowerCase();
  return v !== "off" && v !== "false" && v !== "0";
}

function lang(): string {
  return (process.env.WEB_SEARCH_LANG || "en").replace(/[^a-z-]/gi, "") || "en";
}

async function getJSON(url: string, timeoutMs = 7000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** "== History ==" → "## History"; drops reference-style trailing sections. */
export function wikiToMarkdown(text: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const h = line.match(/^(={2,6})\s*(.+?)\s*\1\s*$/);
    if (h) {
      const level = Math.min(4, h[1].length);
      if (level === 2) skipping = SKIP_SECTIONS.test(h[2]);
      if (!skipping) out.push(`${"#".repeat(level)} ${h[2]}`);
      continue;
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function searchWikipedia(query: string): Promise<SourceDoc[]> {
  const base = `https://${lang()}.wikipedia.org`;
  const search = await getJSON(
    `${base}/w/api.php?action=query&list=search&format=json&srlimit=${MAX_PAGES}&srprop=&srsearch=${encodeURIComponent(query)}`,
  );
  const titles: string[] = (search?.query?.search ?? []).map((r: { title: string }) => r.title);

  // Whole-page extracts are limited to one page per request, so fetch in parallel.
  const pages = await Promise.all(
    titles.map(async (title) => {
      try {
        const data = await getJSON(
          `${base}/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&format=json&titles=${encodeURIComponent(title)}`,
        );
        const page = Object.values(data?.query?.pages ?? {})[0] as { title?: string; extract?: string } | undefined;
        if (!page?.extract) return null;
        const t = page.title ?? title;
        const doc: SourceDoc = {
          docId: `web:wikipedia/${t.replace(/\s+/g, "_")}`,
          title: t,
          repo: "Wikipedia",
          path: t,
          url: `${base}/wiki/${encodeURIComponent(t.replace(/ /g, "_"))}`,
          text: wikiToMarkdown(page.extract).slice(0, MAX_CHARS),
          anchorStyle: "wikipedia",
        };
        return doc;
      } catch {
        return null;
      }
    }),
  );
  return pages.filter((d): d is SourceDoc => !!d && d.text.length > 200);
}

/**
 * Web documents for a topic (cached). Never throws: offline or blocked
 * networks simply yield no web sources, and the lesson falls back to the
 * trusted corpus / model knowledge.
 */
export async function webDocs(topic: string): Promise<SourceDoc[]> {
  if (!webSearchEnabled()) return [];
  const key = `${lang()}:${topic.trim().toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.docs;
  let docs: SourceDoc[] = [];
  const started = Date.now();
  try {
    docs = await searchWikipedia(topic);
    console.log(`[web] wikipedia "${topic}" → ${docs.map((d) => d.title).join(", ") || "nothing"} (${Date.now() - started}ms)`);
  } catch (e) {
    console.warn(`[web] search failed for "${topic}":`, (e as Error).message);
    return []; // don't cache failures: the network may come back
  }
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), docs });
  return docs;
}
