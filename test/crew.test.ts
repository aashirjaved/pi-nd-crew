import assert from "node:assert/strict";
import { test } from "node:test";
import { PERSONAS, personaFor } from "../extensions/crew.ts";

// pi-subagents 0.76 builtin names and aliases. A runtime agent that collides with any
// of these makes the whole `subagent` tool refuse to run, so personas must stay clear.
const TAKEN = new Set([
	"advisor", "claude-code", "claude-code-writer", "codex-exec", "codex-exec-writer", "cursor-agent",
	"cursor-agent-writer", "delegate", "evidence-auditor", "oracle", "researcher", "reviewer", "scout", "worker",
	"developer", "coder", "implementer", "develop",
]);

test("persona names and aliases never collide with pi-subagents builtins", () => {
	for (const p of PERSONAS) {
		assert.ok(!TAKEN.has(p.name), p.name);
		for (const a of p.aliases) {
			assert.ok(!TAKEN.has(a), a);
			assert.match(a, /^nd-/, `alias ${a} must be namespaced`);
		}
	}
});

test("aliases resolve to their persona", () => {
	assert.equal(personaFor("nd-implementer")?.name, "hyperfocus");
	assert.equal(personaFor("LITERAL")?.name, "literal");
	assert.equal(personaFor("worker"), undefined);
});
