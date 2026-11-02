const MAX_REVIEWS = 2;

// What to do next for a ticket resting between runs.
export const nextAction = (ticket) => {
  switch (ticket.phase) {
    case "claimed":
      return { type: "implement" };
    case "implemented":
      return { type: "review", pr: ticket.pr };
    case "reviewed":
      if (ticket.outcome === "Approved") return { type: "handoff" };
      if (ticket.reviews >= MAX_REVIEWS) {
        return {
          type: "escalate",
          reason: `Review ${ticket.reviews} of ${MAX_REVIEWS} was still ${ticket.outcome}; no further address-review runs.`,
        };
      }
      return { type: "answer", pr: ticket.pr, resume: ticket.sessionId };
    case "answered":
      if (ticket.reviews >= MAX_REVIEWS) {
        return { type: "escalate", reason: "Both reviews are used and the last response has no re-review." };
      }
      return { type: "review", pr: ticket.pr };
    case "failed":
      return { type: "escalate", reason: ticket.reason };
    default:
      return { type: "wait" };
  }
};
