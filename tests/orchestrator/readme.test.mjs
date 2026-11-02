import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { read } from "../lib.mjs";

const section = () => {
  const text = read("orchestrator", "README.md");
  assert.ok(text.length > 0, "orchestrator/README.md is missing");
  return text;
};

describe("orchestrator README", () => {
  it("explains how to add a project", () => assert.match(section(), /add a project/i));
  it("explains how to follow a run", () => assert.match(section(), /follow a run/i));
  it("explains how to open a run with claude --resume", () => assert.match(section(), /claude --resume/));
  it("explains how to pause", () => assert.match(section(), /pause/i));
  it("says to stop the project's local services, such as Supabase, first", () => {
    assert.match(section(), /supabase stop|stop .*local services/i);
    assert.match(section(), /Supabase/);
  });
  it("names the secrets file outside the repo", () => {
    assert.match(section(), /~\/\.config\/software-factory\/secrets\.env/);
  });
  it("is linked from the main README", () => {
    assert.match(read("README.md"), /orchestrator\/README\.md/);
  });
});
