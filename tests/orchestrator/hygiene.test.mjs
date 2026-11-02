import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { root } from "../lib.mjs";

const files = (dir) =>
  readdirSync(join(root, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(mjs|json|md)$/.test(f))
    .map((f) => [`${dir}/${f}`, readFileSync(join(root, dir, f), "utf8")]);

describe("the repo holds no secrets", () => {
  const all = [...files("orchestrator"), ...files("tests/orchestrator")];

  it("has script files to check", () => {
    assert.ok(all.length > 0);
  });

  it("contains no Linear, Pushover, Anthropic or GitHub token", () => {
    for (const [name, text] of all) {
      assert.doesNotMatch(text, /lin_api_[A-Za-z0-9]{10,}/, name);
      assert.doesNotMatch(text, /sk-ant-[A-Za-z0-9_-]{10,}/, name);
      assert.doesNotMatch(text, /gh[ps]_[A-Za-z0-9]{20,}/, name);
      assert.doesNotMatch(text, /PUSHOVER_(USER_KEY|APP_TOKEN)\s*=\s*\S+/, name);
    }
  });

  it("ships no config, state or log files", () => {
    const names = readdirSync(join(root, "orchestrator"));
    assert.ok(!names.some((n) => /^(config|state|secrets|runs)\.(json|env|jsonl)$/.test(n)));
  });
});
