import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWrites,
  buildIssue,
  collectActionCandidates,
  collectBundlerCandidate,
  collectCdnjsCandidates,
  collectMiseOutdated,
  parseBundleOutdated,
  parseNpmOutdated,
  parseWorkflowUses,
  planIssueWrites,
  shouldProposeAction,
} from "./deps-propose.mjs";

const checkoutSha = "3d3c42e5aac5ba805825da76410c181273ba90b1";

test("npm outdated の latest だけを候補にする", () => {
  const candidates = parseNpmOutdated({
    tailwindcss: { current: "4.3.3", wanted: "4.3.3", latest: "4.4.0" },
    leftover: { current: "1.0.0", latest: "1.0.0" },
  });
  assert.deepEqual(candidates, [{ ecosystem: "npm", name: "tailwindcss", from: "4.3.3", to: "4.4.0" }]);
});

test("workflow の uses から action と版を取る", () => {
  const pins = parseWorkflowUses(`
jobs:
  build:
    steps:
      - uses: actions/checkout@v7
      - uses: "jdx/mise-action@v5"
      - uses: ./local-action
      - uses: docker://alpine:3.20
        uses: actions/setup-node@v7
`);
  assert.deepEqual(pins, [
    { action: "actions/checkout", version: "v7" },
    { action: "jdx/mise-action", version: "v5" },
    { action: "actions/setup-node", version: "v7" },
  ]);
});

test("commit ピンは行末の版コメントを版にし、コメントが無ければ候補にしない", () => {
  const pins = parseWorkflowUses(`
        uses: actions/checkout@${checkoutSha} # v7.0.1
        uses: actions/setup-node@${checkoutSha}
`);
  assert.deepEqual(pins, [{ action: "actions/checkout", version: "v7.0.1" }]);
});

test("major だけの pin は major が上がったときだけ候補にする", () => {
  assert.equal(shouldProposeAction("v4", "v4.3.0"), false);
  assert.equal(shouldProposeAction("v4", "v5.0.0"), true);
  assert.equal(shouldProposeAction("v4.1.2", "v4.3.0"), true);
  assert.equal(shouldProposeAction("v7", "v7"), false);
});

test("github-actions は major を上げる候補を v 付きの major で出す", async () => {
  const candidates = await collectActionCandidates(
    () => [{ name: "ci.yaml", text: "      - uses: actions/checkout@v7\n      - uses: ruby/setup-ruby@v1\n" }],
    async (owner, repo) => ({ "actions/checkout": "v8.0.0", "ruby/setup-ruby": "v1.300.0" })[`${owner}/${repo}`],
  );
  assert.deepEqual(candidates, [{ ecosystem: "github-actions", name: "actions/checkout", from: "v7", to: "v8" }]);
});

test("bundle outdated の出力から gem の候補を取る", () => {
  const candidates = parseBundleOutdated(`Fetching gem metadata from https://rubygems.org/...
ffi (newest 1.17.5 arm64-darwin, installed 1.17.4 arm64-darwin)
rake (newest 13.5.0, installed 13.4.2, requested ~> 13.3)
`);
  assert.deepEqual(candidates, [
    { ecosystem: "bundler", name: "ffi", from: "1.17.4", to: "1.17.5" },
    { ecosystem: "bundler", name: "rake", from: "13.4.2", to: "13.5.0" },
  ]);
});

test("Bundler は BUNDLED WITH より新しい版があるときだけ候補にする", async () => {
  const lockText = "BUNDLED WITH\n  4.0.20\n";
  assert.deepEqual(await collectBundlerCandidate({ lockText, fetchLatest: async () => "4.0.20" }), []);
  assert.deepEqual(await collectBundlerCandidate({ lockText, fetchLatest: async () => "4.0.23" }), [
    { ecosystem: "bundler", name: "bundler", from: "4.0.20", to: "4.0.23" },
  ]);
});

test("mise はこのリポジトリの mise.toml のツールだけを見て、Node は LTS と比べる", () => {
  const configPath = "/repo/mise.toml";
  const outdated = JSON.stringify({
    node: { name: "node", current: "24.22.1", bump: "26.12.1", source: { path: configPath } },
    ruby: { name: "ruby", current: "4.0.9", bump: "4.0.10", source: { path: configPath } },
    go: { name: "go", current: "1.24.13", bump: "1.27", source: { path: "/home/.config/mise/config.toml" } },
  });
  const candidates = collectMiseOutdated({
    configPath,
    runOutdated: () => outdated,
    latestNodeLts: () => "24.22.1",
  });
  assert.deepEqual(candidates, [{ ecosystem: "mise", name: "ruby", from: "4.0.9", to: "4.0.10" }]);
});

test("cdnjs の参照は新しい版があるときだけ候補にする", async () => {
  const html = ['<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.3.1/css/all.min.css">'];
  assert.deepEqual(await collectCdnjsCandidates(() => html, async () => "7.3.1"), []);
  assert.deepEqual(await collectCdnjsCandidates(() => html, async () => "7.4.0"), [
    { ecosystem: "cdnjs", name: "font-awesome", from: "7.3.1", to: "7.4.0" },
  ]);
});

test("Issue の題は完了条件で、本文に重複防止の印がある", () => {
  const issue = buildIssue({ ecosystem: "npm", name: "tailwindcss", from: "4.3.3", to: "4.4.0" });
  assert.equal(issue.title, "tailwindcss を 4.3.3 から 4.4.0 へ上げる");
  assert.deepEqual(issue.labels, []);
  assert.ok(issue.body.includes("<!-- deps-propose:npm:tailwindcss -->"));
});

test("同じ印の Issue があれば作らず、版が変わったら更新する", () => {
  const same = buildIssue({ ecosystem: "npm", name: "tailwindcss", from: "4.3.3", to: "4.4.0" });
  const writes = planIssueWrites(
    [
      { ecosystem: "npm", name: "tailwindcss", from: "4.3.3", to: "4.4.0" },
      { ecosystem: "bundler", name: "bundler", from: "4.0.20", to: "4.0.23" },
    ],
    [
      { number: 10, title: same.title, body: same.body },
      { number: 11, title: "別件", body: "印は無い" },
    ],
  );
  assert.deepEqual(
    writes.map((write) => [write.action, write.number]),
    [
      ["skip", 10],
      ["create", undefined],
    ],
  );

  const newer = planIssueWrites(
    [{ ecosystem: "npm", name: "tailwindcss", from: "4.3.3", to: "4.5.0" }],
    [{ number: 10, title: same.title, body: same.body }],
  );
  assert.equal(newer[0].action, "update");
  assert.equal(newer[0].issue.title, "tailwindcss を 4.3.3 から 4.5.0 へ上げる");
});

test("候補から外れた依存の Issue だけを閉じる", () => {
  const stale = buildIssue({ ecosystem: "bundler", name: "bundler", from: "4.0.20", to: "4.0.23" });
  const kept = buildIssue({ ecosystem: "npm", name: "tailwindcss", from: "4.3.3", to: "4.4.0" });
  const writes = planIssueWrites(
    [{ ecosystem: "npm", name: "tailwindcss", from: "4.3.3", to: "4.4.0" }],
    [
      { number: 20, title: stale.title, body: stale.body },
      { number: 21, title: kept.title, body: kept.body },
      { number: 22, title: "別件", body: "印は無い" },
      { number: 23, title: "PR", body: stale.body, pull_request: {} },
    ],
  );
  assert.deepEqual(
    writes.map((write) => [write.action, write.number]),
    [
      ["skip", 21],
      ["close", 20],
    ],
  );
});

test("閉じるときはコメントを残してから closed にする", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({}) };
  };
  const result = await applyWrites({
    owner: "o",
    repo: "r",
    token: "t",
    writes: [{ action: "close", number: 20, title: "x" }],
    fetchImpl,
  });
  assert.deepEqual(result.closed, [20]);
  assert.deepEqual(
    calls.map((call) => [call.method, call.url]),
    [
      ["POST", "https://api.github.com/repos/o/r/issues/20/comments"],
      ["PATCH", "https://api.github.com/repos/o/r/issues/20"],
    ],
  );
  assert.deepEqual(calls[1].body, { state: "closed", state_reason: "completed" });
});
