#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const MARKER_PREFIX = "deps-propose";

export function markerFor(ecosystem, name) {
  return `<!-- ${MARKER_PREFIX}:${ecosystem}:${name} -->`;
}

export function parseVersion(raw) {
  const text = String(raw ?? "")
    .trim()
    .replace(/^v/i, "");
  const match = text.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? null : Number(match[2]),
    patch: match[3] === undefined ? null : Number(match[3]),
  };
}

export function compareVersions(leftRaw, rightRaw) {
  const left = parseVersion(leftRaw);
  const right = parseVersion(rightRaw);
  if (!left || !right) {
    return String(leftRaw) === String(rightRaw) ? 0 : 1;
  }
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  const leftMinor = left.minor ?? 0;
  const rightMinor = right.minor ?? 0;
  if (leftMinor !== rightMinor) {
    return leftMinor - rightMinor;
  }
  return (left.patch ?? 0) - (right.patch ?? 0);
}

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

function isCommitSha(version) {
  return COMMIT_SHA.test(String(version ?? ""));
}

export function shouldProposeAction(current, latest) {
  if (!current || !latest || current === latest || isCommitSha(current)) {
    return false;
  }
  const parsedCurrent = parseVersion(current);
  if (parsedCurrent && parsedCurrent.minor === null && parsedCurrent.patch === null) {
    const parsedLatest = parseVersion(latest);
    return Boolean(parsedLatest && parsedLatest.major > parsedCurrent.major);
  }
  return compareVersions(latest, current) > 0;
}

export function actionTargetVersion(current, latest) {
  const parsedCurrent = parseVersion(current);
  const parsedLatest = parseVersion(latest);
  if (parsedCurrent && parsedCurrent.minor === null && parsedLatest) {
    return `v${parsedLatest.major}`;
  }
  return latest;
}

export function parseNpmOutdated(raw) {
  if (raw == null || String(raw).trim() === "" || String(raw).trim() === "{}") {
    return [];
  }
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Object.entries(parsed)
    .map(([name, info]) => ({
      ecosystem: "npm",
      name,
      from: String(info.current ?? ""),
      to: String(info.latest ?? ""),
    }))
    .filter((item) => item.from && item.to && item.from !== item.to);
}

export function parseBundleOutdated(raw) {
  const found = [];
  for (const match of String(raw ?? "").matchAll(/^(\S+) \(newest ([^,\s]+)[^,]*, installed ([^,\s)]+)/gm)) {
    found.push({ ecosystem: "bundler", name: match[1], from: match[3], to: match[2] });
  }
  return found;
}

export function parseBundledWith(lockText) {
  const match = String(lockText ?? "").match(/^BUNDLED WITH\n\s+(\S+)/m);
  return match ? match[1] : null;
}

export function parseMiseOutdated(raw, configPath) {
  const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
  return Object.values(parsed)
    .filter((info) => info.source?.path === configPath)
    .map((info) => ({
      ecosystem: "mise",
      name: info.name,
      from: String(info.current ?? ""),
      to: String(info.bump ?? info.latest ?? ""),
    }))
    .filter((item) => item.from && item.to && item.from !== item.to);
}

export function parseCdnjsRefs(texts) {
  const found = new Map();
  for (const text of texts) {
    for (const match of String(text).matchAll(/cdnjs\.cloudflare\.com\/ajax\/libs\/([^/]+)\/([^/]+)\//g)) {
      found.set(`${match[1]}@${match[2]}`, { name: match[1], version: match[2] });
    }
  }
  return [...found.values()];
}

function versionComment(line) {
  const commented = String(line).match(/#\s*(v\d+(?:\.\d+){0,2})\b/i);
  if (!commented) {
    return null;
  }
  const token = commented[1];
  return token[0] === "V" ? `v${token.slice(1)}` : token;
}

export function parseWorkflowUses(text) {
  const found = [];
  const source = String(text);
  for (const match of source.matchAll(/^\s+(?:-\s+)?uses:\s+["']?([^#\s"']+)/gm)) {
    const spec = match[1];
    if (spec.startsWith("./") || spec.startsWith("docker://")) {
      continue;
    }
    const at = spec.lastIndexOf("@");
    if (at <= 0) {
      continue;
    }
    const action = spec.slice(0, at);
    const ref = spec.slice(at + 1);
    if (!action.includes("/")) {
      continue;
    }
    const lineEnd = source.indexOf("\n", match.index + 1);
    const line = source.slice(match.index, lineEnd === -1 ? source.length : lineEnd);
    const version = isCommitSha(ref) ? versionComment(line) : ref;
    if (!version) {
      continue;
    }
    found.push({ action, version });
  }
  return found;
}

export function actionRepo(action) {
  const [owner, repo] = action.split("/");
  return { owner, repo };
}

export function buildIssue(candidate) {
  const marker = markerFor(candidate.ecosystem, candidate.name);
  const title = `${candidate.name} を ${candidate.from} から ${candidate.to} へ上げる`;
  const body = `### 背景・目的

${candidate.name} の新しい版がある。いまの版は ${candidate.from} である。新しい版は ${candidate.to} である。
人は、この Issue を見てから、必要なら PR を作る。

### やること

- [ ] ${candidate.name} を ${candidate.from} から ${candidate.to} へ上げる

### 受入基準

- [ ] ${candidate.name} の版が ${candidate.to} である
- [ ] \`mise run validate\` が通る

### その他

週次の依存確認が残した候補である。

${marker}
`;
  return { title, body, marker, labels: [] };
}

export function findExistingIssue(issues, candidate) {
  const marker = markerFor(candidate.ecosystem, candidate.name);
  return issues.find((issue) => !issue.pull_request && String(issue.body ?? "").includes(marker)) ?? null;
}

export function planIssueWrites(candidates, issues) {
  const writes = [];
  for (const candidate of candidates) {
    const existing = findExistingIssue(issues, candidate);
    const next = buildIssue(candidate);
    if (!existing) {
      writes.push({ action: "create", candidate, issue: next });
      continue;
    }
    if (existing.title === next.title) {
      writes.push({ action: "skip", candidate, number: existing.number });
      continue;
    }
    writes.push({
      action: "update",
      candidate,
      number: existing.number,
      issue: next,
    });
  }
  // 候補から外れた依存の Issue は、上げ終わったか上げる必要が無くなったので閉じる。
  const wanted = new Set(candidates.map((candidate) => markerFor(candidate.ecosystem, candidate.name)));
  for (const issue of issues) {
    if (issue.pull_request) {
      continue;
    }
    const marker = String(issue.body ?? "").match(new RegExp(`<!-- ${MARKER_PREFIX}:.+? -->`));
    if (marker && !wanted.has(marker[0])) {
      writes.push({ action: "close", number: issue.number, title: issue.title });
    }
  }
  return writes;
}

export function collectNpmOutdated(runNpmOutdated = defaultNpmOutdated) {
  return parseNpmOutdated(runNpmOutdated());
}

export function listWorkflowActionPins(readWorkflows = defaultReadWorkflows) {
  const pins = [];
  const seen = new Set();
  for (const { name, text } of readWorkflows()) {
    for (const pin of parseWorkflowUses(text)) {
      const key = `${pin.action}@${pin.version}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      pins.push({ ...pin, workflow: name });
    }
  }
  return pins;
}

export async function collectActionCandidates(
  readWorkflows = defaultReadWorkflows,
  fetchLatest = defaultFetchLatestRelease,
) {
  const candidates = [];
  const latestByRepo = new Map();
  for (const pin of listWorkflowActionPins(readWorkflows)) {
    const { owner, repo } = actionRepo(pin.action);
    const repoKey = `${owner}/${repo}`;
    if (!latestByRepo.has(repoKey)) {
      latestByRepo.set(repoKey, await fetchLatest(owner, repo));
    }
    const latest = latestByRepo.get(repoKey);
    if (!latest || !shouldProposeAction(pin.version, latest)) {
      continue;
    }
    candidates.push({
      ecosystem: "github-actions",
      name: pin.action,
      from: pin.version,
      to: actionTargetVersion(pin.version, latest),
    });
  }
  return candidates;
}

export function defaultNpmOutdated() {
  try {
    return execFileSync("npm", ["outdated", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.trim() !== "") {
      return error.stdout;
    }
    throw error;
  }
}

function runAllowingExit1(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (error.status === 1 && typeof error.stdout === "string") {
      return error.stdout;
    }
    throw error;
  }
}

// --strict で、ほかの gem の制約で上げられない版を除く。
export function collectBundleOutdated(
  run = () => runAllowingExit1("bundle", ["outdated", "--parseable", "--strict"]),
) {
  return parseBundleOutdated(run());
}

// Node は最新ではなく LTS の最新と比べる。
export function collectMiseOutdated({
  configPath = join(process.cwd(), "mise.toml"),
  runOutdated = () => runAllowingExit1("mise", ["outdated", "--bump", "--json"]),
  latestNodeLts = () => execFileSync("mise", ["latest", "node@lts"], { encoding: "utf8" }).trim(),
} = {}) {
  return parseMiseOutdated(runOutdated(), configPath)
    .map((item) => (item.name === "node" ? { ...item, to: latestNodeLts() } : item))
    .filter((item) => compareVersions(item.to, item.from) > 0);
}

export async function collectBundlerCandidate({
  lockText = readFileSync(join(process.cwd(), "Gemfile.lock"), "utf8"),
  fetchLatest = defaultFetchLatestBundler,
} = {}) {
  const current = parseBundledWith(lockText);
  const latest = current ? await fetchLatest() : null;
  if (!latest || compareVersions(latest, current) <= 0) {
    return [];
  }
  return [{ ecosystem: "bundler", name: "bundler", from: current, to: latest }];
}

export async function collectCdnjsCandidates(readHtml = defaultReadHtml, fetchLatest = defaultFetchLatestCdnjs) {
  const candidates = [];
  for (const ref of parseCdnjsRefs(readHtml())) {
    const latest = await fetchLatest(ref.name);
    if (latest && compareVersions(latest, ref.version) > 0) {
      candidates.push({ ecosystem: "cdnjs", name: ref.name, from: ref.version, to: latest });
    }
  }
  return candidates;
}

export function defaultReadHtml(dir = join(process.cwd(), "docs")) {
  return readdirSync(dir, { recursive: true })
    .filter((name) => name.endsWith(".html"))
    .map((name) => readFileSync(join(dir, name), "utf8"));
}

async function fetchJson(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`${url} が取れない。status=${response.status}`);
  }
  return response.json();
}

export async function defaultFetchLatestBundler() {
  const payload = await fetchJson("https://rubygems.org/api/v1/versions/bundler/latest.json");
  return payload.version ?? null;
}

export async function defaultFetchLatestCdnjs(name) {
  const payload = await fetchJson(`https://api.cdnjs.com/libraries/${encodeURIComponent(name)}?fields=version`);
  return payload.version ?? null;
}

export function defaultReadWorkflows(workflowsDir = join(process.cwd(), ".github/workflows")) {
  return readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => ({
      name,
      text: readFileSync(join(workflowsDir, name), "utf8"),
    }));
}

export async function defaultFetchLatestRelease(owner, repo, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: githubHeaders(),
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`${owner}/${repo} の latest release が取れない。status=${response.status}`);
  }
  const payload = await response.json();
  return payload.tag_name ?? null;
}

export function githubHeaders(token = process.env.GITHUB_TOKEN) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "choimake.github.io-deps-propose",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function repositoryFromEnv(env = process.env) {
  const value = env.GITHUB_REPOSITORY ?? "";
  const [owner, repo] = value.split("/");
  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY が無い。owner/repo の形で渡す。");
  }
  return { owner, repo };
}

export async function listOpenIssues({ owner, repo, token, fetchImpl = fetch }) {
  const issues = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100&page=${page}`;
    const response = await fetchImpl(url, { headers: githubHeaders(token) });
    if (!response.ok) {
      throw new Error(`Issue 一覧が取れない。status=${response.status}`);
    }
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }
    issues.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return issues;
}

export async function applyWrites({ owner, repo, token, writes, fetchImpl = fetch }) {
  const created = [];
  const updated = [];
  const closed = [];
  for (const write of writes) {
    if (write.action === "skip") {
      continue;
    }
    if (write.action === "close") {
      const issueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${write.number}`;
      const headers = { ...githubHeaders(token), "Content-Type": "application/json" };
      const comment = await fetchImpl(`${issueUrl}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body: "週次の依存確認で更新候補から外れたので閉じる。" }),
      });
      if (!comment.ok) {
        throw new Error(`Issue #${write.number} にコメントできない。status=${comment.status}`);
      }
      const response = await fetchImpl(issueUrl, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ state: "closed", state_reason: "completed" }),
      });
      if (!response.ok) {
        throw new Error(`Issue #${write.number} を閉じられない。status=${response.status}`);
      }
      closed.push(write.number);
      continue;
    }
    if (write.action === "create") {
      const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: "POST",
        headers: {
          ...githubHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: write.issue.title,
          body: write.issue.body,
          labels: write.issue.labels,
        }),
      });
      if (!response.ok) {
        throw new Error(`${write.candidate.name} の Issue が作れない。status=${response.status}`);
      }
      const payload = await response.json();
      created.push(payload.number);
      continue;
    }
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/issues/${write.number}`, {
      method: "PATCH",
      headers: {
        ...githubHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: write.issue.title,
        body: write.issue.body,
      }),
    });
    if (!response.ok) {
      throw new Error(`${write.candidate.name} の Issue #${write.number} を更新できない。status=${response.status}`);
    }
    updated.push(write.number);
  }
  return { created, updated, closed };
}

export async function collectCandidates({
  runNpmOutdated = defaultNpmOutdated,
  readWorkflows = defaultReadWorkflows,
  fetchLatest = defaultFetchLatestRelease,
} = {}) {
  const npm = collectNpmOutdated(runNpmOutdated);
  const actions = await collectActionCandidates(readWorkflows, fetchLatest);
  const gems = collectBundleOutdated();
  const bundler = await collectBundlerCandidate();
  const tools = collectMiseOutdated();
  const cdnjs = await collectCdnjsCandidates();
  return [...npm, ...actions, ...gems, ...bundler, ...tools, ...cdnjs];
}

function printWrites(writes) {
  if (writes.length === 0) {
    console.log("更新候補は無い。");
    return;
  }
  for (const write of writes) {
    if (write.action === "close") {
      console.log(`close\t#${write.number}\t${write.title}`);
      continue;
    }
    const target = `${write.candidate.ecosystem} ${write.candidate.name} ${write.candidate.from} -> ${write.candidate.to}`;
    if (write.action === "create") {
      console.log(`create\t${target}`);
      continue;
    }
    if (write.action === "update") {
      console.log(`update\t#${write.number}\t${target}`);
      continue;
    }
    console.log(`skip\t#${write.number}\t${target}`);
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const apply = argv.includes("--apply");
  const candidates = await collectCandidates();
  if (!apply) {
    if (candidates.length === 0) {
      console.log("更新候補は無い。");
      return;
    }
    for (const candidate of candidates) {
      console.log(`${candidate.ecosystem}\t${candidate.name}\t${candidate.from}\t${candidate.to}`);
    }
    return;
  }
  const token = env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN が無い。--apply にはトークンが要る。");
  }
  const { owner, repo } = repositoryFromEnv(env);
  const issues = await listOpenIssues({ owner, repo, token });
  const writes = planIssueWrites(candidates, issues);
  printWrites(writes);
  const result = await applyWrites({ owner, repo, token, writes });
  console.log(`created=${result.created.join(",") || "none"} updated=${result.updated.join(",") || "none"} closed=${result.closed.join(",") || "none"}`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
