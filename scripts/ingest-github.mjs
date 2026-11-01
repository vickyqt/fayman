#!/usr/bin/env node
/**
 * Pulls markdown from the trusted repos in config/trusted-repos.json into
 * data/corpus.json. Chunking + indexing happen at server start
 * (lib/retrieval), so this file only stores raw documents with their
 * canonical GitHub URLs (used for citation deep links).
 *
 *   npm run ingest              # all repos
 *   npm run ingest -- docker    # only repos whose name contains "docker"
 *   GITHUB_TOKEN=... npm run ingest   # higher rate limits
 *
 * Never fails the process: a repo that can't be fetched is skipped (keeping
 * its previously ingested files, if any), so it is safe in a deploy build.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const cfg = JSON.parse(fs.readFileSync(path.join(root, "config/trusted-repos.json"), "utf8"));
const filter = process.argv[2]?.toLowerCase();
const headers = { "user-agent": "feynman-lab-ingest", accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function gh(url) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function titleOf(text, file) {
  // `title:` may be the first frontmatter line (MDN, react.dev), so search the block line by line.
  const block = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
  const fm = block?.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  if (fm) return fm[1];
  const h = text.match(/^#\s+(.+)$/m);
  return h ? h[1].trim() : path.basename(file);
}

const outFile = path.join(root, "data/corpus.json");
let existing = [];
try {
  if (fs.existsSync(outFile)) existing = JSON.parse(fs.readFileSync(outFile, "utf8"));
} catch (e) {
  console.warn(`Ignoring unreadable ${outFile}: ${e.message}`);
}

// Repos outside the filter keep their documents; so does any repo whose re-ingest fails below.
const docs = existing.filter((d) => filter && !d.repo.toLowerCase().includes(filter));
const keepOld = (repo) => {
  const old = existing.filter((d) => d.repo === repo);
  if (old.length) {
    docs.push(...old);
    console.warn(`  kept ${old.length} previously ingested file(s) for ${repo}`);
  }
};

async function fetchRaw(repo, branch, file) {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${file}`, {
    headers: { "user-agent": headers["user-agent"] },
    signal: AbortSignal.timeout(20_000), // never hang a deploy build on one slow file
  });
  // Normalise line endings so frontmatter and heading parsing behave the same everywhere.
  return res.ok ? (await res.text()).replace(/\r\n?/g, "\n") : null;
}

for (const entry of cfg.repos) {
  if (filter && !entry.repo.toLowerCase().includes(filter)) continue;
  const before = docs.length;
  try {
    const exactFiles = (entry.include ?? []).filter((p) => /\.mdx?$/i.test(p));
    const prefixes = (entry.include ?? []).filter((p) => !/\.mdx?$/i.test(p));
    let branch = entry.branch;
    let files = [];

    if (prefixes.length || !entry.include) {
      // Directory prefixes need the tree API (rate-limited without GITHUB_TOKEN).
      const meta = await gh(`https://api.github.com/repos/${entry.repo}`);
      branch ??= meta.default_branch;
      const tree = await gh(`https://api.github.com/repos/${entry.repo}/git/trees/${branch}?recursive=1`);
      files = tree.tree
        .filter((t) => t.type === "blob" && /\.mdx?$/i.test(t.path))
        .filter((t) => !entry.include || entry.include.some((p) => t.path === p || t.path.startsWith(p)))
        .map((t) => t.path);
    } else {
      files = exactFiles; // exact paths: raw download only, no API calls
    }
    files = files.slice(0, entry.maxFiles ?? 20);

    let count = 0;
    for (const file of files) {
      let text = null;
      for (const b of branch ? [branch] : ["main", "master"]) {
        text = await fetchRaw(entry.repo, b, file);
        if (text !== null) { branch = b; break; }
      }
      if (text === null) { console.warn(`  skip ${entry.repo}/${file} (not found)`); continue; }
      const title = titleOf(text, file);
      text = text.replace(/^---\n[\s\S]*?\n---\n/, ""); // drop frontmatter
      docs.push({
        docId: `gh:${entry.repo}/${file}`,
        title,
        repo: entry.repo,
        path: file,
        url: `https://github.com/${entry.repo}/blob/${branch}/${file}`,
        text,
      });
      count++;
    }
    console.log(`${count ? "✓" : "✗"} ${entry.repo}@${branch}: ${count} file(s)`);
    if (!count) keepOld(entry.repo);
  } catch (e) {
    console.warn(`✗ ${entry.repo}: ${e.message.slice(0, 160)}`);
    docs.length = before;
    keepOld(entry.repo);
  }
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(docs));
console.log(`Wrote ${docs.length} documents to data/corpus.json. Restart the server to re-index.`);
