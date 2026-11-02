const RELEASED = new Set(["handed-off", "escalated"]);

export const holdsSlot = (ticket) => !RELEASED.has(ticket.phase);

export const slotHolder = (tickets) => tickets.find(holdsSlot)?.key ?? null;

export const canStart = (tickets) => slotHolder(tickets) === null;
