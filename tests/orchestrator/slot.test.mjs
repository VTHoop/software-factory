import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canStart, slotHolder } from "../../orchestrator/slot.mjs";

const HOLDING = [
  "claimed",
  "implementing",
  "implemented",
  "reviewing",
  "reviewed",
  "answering",
  "answered",
  "awaiting-ci",
];

describe("slot", () => {
  for (const phase of HOLDING) {
    it(`is held in ${phase}, including the gaps between runs and the CI wait`, () => {
      const tickets = [{ key: "HEA-1", phase }];
      assert.equal(slotHolder(tickets), "HEA-1");
      assert.equal(canStart(tickets), false);
    });
  }

  it("is released once a ticket is handed off", () => {
    assert.equal(canStart([{ key: "HEA-1", phase: "handed-off" }]), true);
  });

  it("is released once a ticket is escalated", () => {
    assert.equal(canStart([{ key: "HEA-1", phase: "escalated" }]), true);
  });

  it("is not held by a PR waiting for the owner's test while another runs", () => {
    const tickets = [
      { key: "HEA-1", phase: "handed-off" },
      { key: "HEA-2", phase: "reviewing" },
    ];
    assert.equal(slotHolder(tickets), "HEA-2");
  });

  it("is free with no tickets, so tickets worked by hand never hold it", () => {
    assert.equal(slotHolder([]), null);
    assert.equal(canStart([]), true);
  });
});
