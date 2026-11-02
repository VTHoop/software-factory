// The script owns every escalation; a stopped skill posts none of its own.
export const escalate = async (ticket, reason, deps, { denied = [] } = {}) => {
  const links = [ticket.issueUrl, ticket.prUrl].filter(Boolean);
  const body = [
    `🛑 Escalated to the owner: ${reason}`,
    ...(denied.length ? ["", "Denied commands:", ...denied.map((c) => `- \`${c}\``)] : []),
    ...(links.length ? ["", ...links] : []),
  ].join("\n");
  await deps.linear.comment(ticket.key, body);
  if (ticket.pr) await deps.github.comment(ticket.pr, body);
  await deps.linear.addLabel(ticket.key, "needs-owner");
  if (!ticket.pr) await deps.linear.setStatus(ticket.key, "Todo");
  await deps.notify({
    kind: "escalation",
    title: `${ticket.key} needs you`,
    message: [reason, ...denied, ...links].join("\n"),
    url: ticket.prUrl ?? ticket.issueUrl,
  });
  return { ...ticket, phase: "escalated", reason };
};
