const section = (text, heading) => {
  const start = text.indexOf(heading);
  if (start === -1) return "";
  const rest = text.slice(start + heading.length);
  const next = rest.search(/^#{1,3} /m);
  return next === -1 ? rest : rest.slice(0, next);
};

const items = (text, pattern) =>
  text
    .split("\n")
    .map((line) => line.match(pattern)?.[1]?.trim())
    .filter(Boolean);

export const parseManualTest = (prBody) => {
  const before = items(section(prBody, "### Before testing"), /^- (?!\[ \])(.+)$/).filter(
    (item) => !/^nothing\.?$/i.test(item),
  );
  const checklist = items(section(prBody, "### Checklist"), /^- \[ \] (.+)$/);
  return { before, checklist };
};

export const parseResponse = (body) => {
  const rows = String(body ?? "")
    .split("\n")
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .map(([, , finding, severity, disposition, evidence]) => ({ finding, severity, disposition, evidence }));
  return {
    dismissed: rows.filter((r) => r.disposition.startsWith("Dismissed")),
    deferred: rows.filter((r) => r.disposition.startsWith("Deferred")),
  };
};

const lines = (title, list) => (list.length ? [`${title}:`, ...list.map((i) => `- ${i}`)] : []);

export const buildHandoff = ({ key, pr, prBody, response, outcome, ci, freshAnswer }) => {
  const { before, checklist } = parseManualTest(prBody ?? "");
  const { dismissed, deferred } = parseResponse(response);
  const message = [
    `PR: ${pr.url}`,
    pr.previewUrl ? `Preview: ${pr.previewUrl}` : "Preview: none found",
    `Review: Overall ${outcome} · CI: ${ci.state}`,
    ...(freshAnswer ? ["The review was answered in a fresh session; the implementer session could not be resumed."] : []),
    ...lines("Do first", before),
    ...lines("Test", checklist),
    ...lines("Dismissed", dismissed.map((d) => `${d.finding} (${d.severity}): ${d.evidence}`)),
    ...lines("Deferred", deferred.map((d) => `${d.finding} (${d.severity}): ${d.evidence}`)),
  ].join("\n");
  return { kind: "handoff", title: `${key} is ready for your test`, message, url: pr.url };
};

export const waitForCi = async ({ getState, sleep, now = Date.now, timeoutMs, intervalMs }) => {
  const start = now();
  while (true) {
    const state = await getState();
    if (state !== "pending") return { state };
    if (now() - start + intervalMs > timeoutMs) return { state: "timed-out" };
    await sleep(intervalMs);
  }
};

export const handoff = async (ticket, deps) => {
  const sha = await deps.github.headSha(ticket.pr);
  const ci = await waitForCi({
    getState: () => deps.github.ciState(sha),
    sleep: deps.sleep,
    timeoutMs: deps.config.ciTimeoutMs,
    intervalMs: deps.config.ciIntervalMs,
  });
  const pr = await deps.github.prDetails(ticket.pr);
  const response = await deps.github.response(ticket.pr);
  await deps.notify(
    buildHandoff({
      key: ticket.key,
      pr,
      prBody: pr.body,
      response,
      outcome: ticket.outcome,
      ci,
      freshAnswer: ticket.freshAnswer,
    }),
  );
  await deps.linear.setStatus(ticket.key, "In Review");
  return { ...ticket, phase: "handed-off" };
};
