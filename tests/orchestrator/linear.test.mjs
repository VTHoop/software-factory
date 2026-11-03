import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectIssues, createLinear } from "../../orchestrator/linear.mjs";

const fakeFetch = (handlers) => {
  const requests = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, init, ...body });
    const key = Object.keys(handlers).find((k) => body.query.includes(k));
    if (!key) throw new Error(`unexpected query: ${body.query.slice(0, 60)}`);
    return { ok: true, json: async () => ({ data: handlers[key](body.variables) }) };
  };
  return { fetch, requests };
};

const node = (over = {}) => ({
  identifier: "HEA-5",
  priority: 2,
  createdAt: "2026-11-01T00:00:00Z",
  branchName: "pathooper83/hea-5-x",
  url: "https://linear.app/x/HEA-5",
  state: { name: "Ready" },
  team: { name: "Health Agent" },
  project: { name: "Sidekick" },
  labels: { nodes: [{ name: "needs-owner" }] },
  inverseRelations: {
    nodes: [
      { type: "blocks", issue: { identifier: "HEA-1", state: { name: "In Review" } } },
      { type: "related", issue: { identifier: "HEA-2", state: { name: "Todo" } } },
    ],
  },
  ...over,
});

const issueQuery = () => ({
  issue: { id: "uuid-1", team: { id: "t1", states: { nodes: [{ id: "s1", name: "In Progress" }] } } },
});

describe("createLinear", () => {
  it("lists Ready issues of the entries' teams and maps them", async () => {
    const { fetch, requests } = fakeFetch({ "issues(": () => ({ issues: { nodes: [node(), node({ project: null })] } }) });
    const issues = await createLinear("key", fetch).listIssues([{ team: "Health Agent" }, { team: "Health Agent" }]);
    assert.deepEqual(requests[0].variables.teams, ["Health Agent"]);
    assert.equal(issues[0].key, "HEA-5");
    assert.equal(issues[0].team, "Health Agent");
    assert.deepEqual(issues[0].labels, ["needs-owner"]);
    assert.equal(issues[1].project, null);
  });

  it("counts only 'blocks' relations as blockers", async () => {
    const { fetch } = fakeFetch({ "issues(": () => ({ issues: { nodes: [node()] } }) });
    const [issue] = await createLinear("key", fetch).listIssues([{ team: "T" }]);
    assert.deepEqual(issue.blockedBy, [{ key: "HEA-1", status: "In Review" }]);
  });

  it("sends the API key as the Authorization header and a time limit on every request", async () => {
    const { fetch, requests } = fakeFetch({ "issues(": () => ({ issues: { nodes: [] } }) });
    await createLinear("the-key", fetch).listIssues([{ team: "T" }]);
    assert.equal(requests[0].init.headers.Authorization, "the-key");
    assert.ok(requests[0].init.signal instanceof AbortSignal);
  });

  it("says which status is missing", async () => {
    const { fetch } = fakeFetch({ "issue(id": issueQuery });
    await assert.rejects(createLinear("k", fetch).setStatus("HEA-1", "Nope"), /Nope/);
  });

  it("says which label is missing", async () => {
    const { fetch } = fakeFetch({ "issue(id": issueQuery, "issueLabels": () => ({ issueLabels: { nodes: [] } }) });
    await assert.rejects(createLinear("k", fetch).addLabel("HEA-1", "needs-owner"), /needs-owner/);
  });

  it("looks an issue up once for several calls on it", async () => {
    const { fetch, requests } = fakeFetch({
      "issue(id": issueQuery,
      issueUpdate: () => ({}),
      commentCreate: () => ({}),
    });
    const linear = createLinear("k", fetch);
    await linear.setStatus("HEA-1", "In Progress");
    await linear.comment("HEA-1", "hi");
    assert.equal(requests.filter((r) => r.query.includes("issue(id")).length, 1);
  });
});

describe("createLinear paging and errors", () => {
  it("reads every page of Ready issues, not just the first 100", async () => {
    const pages = [
      { nodes: [node({ identifier: "HEA-1" })], pageInfo: { hasNextPage: true, endCursor: "c1" } },
      { nodes: [node({ identifier: "HEA-2" })], pageInfo: { hasNextPage: false, endCursor: null } },
    ];
    const { fetch, requests } = fakeFetch({ "issues(": (v) => ({ issues: pages[v.after ? 1 : 0] }) });
    const issues = await createLinear("k", fetch).listIssues([{ team: "T" }]);
    assert.deepEqual(issues.map((i) => i.key), ["HEA-1", "HEA-2"]);
    assert.equal(requests[1].variables.after, "c1");
  });

  it("throws on an HTTP error without echoing the key", async () => {
    const fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    await assert.rejects(createLinear("secret-key", fetch).listIssues([{ team: "T" }]), (e) => {
      assert.match(e.message, /401/);
      assert.ok(!e.message.includes("secret-key"));
      return true;
    });
  });

  it("throws on a GraphQL error", async () => {
    const fetch = async () => ({ ok: true, json: async () => ({ errors: [{ message: "bad filter" }] }) });
    await assert.rejects(createLinear("k", fetch).listIssues([{ team: "T" }]), /bad filter/);
  });
});

describe("collectIssues", () => {
  it("asks each entry's Linear client and drops duplicates by key", async () => {
    const make = (...keys) => ({ listIssues: async () => keys.map((key) => ({ key })) });
    const issues = await collectIssues([
      { entry: { team: "A" }, linear: make("HEA-1", "HEA-2") },
      { entry: { team: "B" }, linear: make("HEA-2", "HEA-3") },
    ]);
    assert.deepEqual(issues.map((i) => i.key), ["HEA-1", "HEA-2", "HEA-3"]);
  });
});
