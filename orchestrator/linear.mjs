const ENDPOINT = "https://api.linear.app/graphql";

// Reads and writes Linear directly, with no model, using a personal API key.
export const createLinear = (key, fetch = globalThis.fetch) => {
  const query = async (text, variables = {}) => {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: key },
      body: JSON.stringify({ query: text, variables }),
    });
    const body = await response.json();
    if (!response.ok || body.errors) {
      throw new Error(`Linear request failed: ${JSON.stringify(body.errors ?? response.status).slice(0, 300)}`);
    }
    return body.data;
  };

  const issueByKey = async (issueKey) =>
    (
      await query(
        `query($id: String!) { issue(id: $id) { id team { id states { nodes { id name } } } } }`,
        { id: issueKey },
      )
    ).issue;

  return {
    async listIssues(entries) {
      const data = await query(
        `query($teams: [String!]) {
          issues(first: 100, filter: { state: { name: { eq: "Ready" } }, team: { name: { in: $teams } } }) {
            nodes {
              identifier priority createdAt branchName url
              state { name } team { name } project { name }
              labels { nodes { name } }
              inverseRelations { nodes { type issue { identifier state { name } } } }
            }
          }
        }`,
        { teams: [...new Set(entries.map((e) => e.team))] },
      );
      return data.issues.nodes.map((n) => ({
        key: n.identifier,
        status: n.state.name,
        team: n.team.name,
        project: n.project?.name ?? null,
        priority: n.priority,
        createdAt: n.createdAt,
        gitBranchName: n.branchName,
        url: n.url,
        labels: n.labels.nodes.map((l) => l.name),
        blockedBy: n.inverseRelations.nodes
          .filter((r) => r.type === "blocks")
          .map((r) => ({ key: r.issue.identifier, status: r.issue.state.name })),
      }));
    },

    async setStatus(issueKey, name) {
      const issue = await issueByKey(issueKey);
      const state = issue.team.states.nodes.find((s) => s.name === name);
      if (!state) throw new Error(`Team has no status named ${name}`);
      await query(`mutation($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }`, {
        id: issue.id,
        state: state.id,
      });
    },

    async comment(issueKey, body) {
      const issue = await issueByKey(issueKey);
      await query(`mutation($id: String!, $body: String!) { commentCreate(input: { issueId: $id, body: $body }) { success } }`, {
        id: issue.id,
        body,
      });
    },

    async addLabel(issueKey, name) {
      const issue = await issueByKey(issueKey);
      const labels = await query(
        `query($team: ID!, $name: String!) { issueLabels(filter: { name: { eq: $name }, or: [{ team: { id: { eq: $team } } }, { team: { null: true } }] }) { nodes { id } } }`,
        { team: issue.team.id, name },
      );
      const label = labels.issueLabels.nodes[0];
      if (!label) throw new Error(`No label named ${name}`);
      await query(`mutation($id: String!, $label: String!) { issueAddLabel(id: $id, labelId: $label) { success } }`, {
        id: issue.id,
        label: label.id,
      });
    },
  };
};
