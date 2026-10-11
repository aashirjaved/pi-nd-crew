import assert from "node:assert/strict";
import { test } from "node:test";
import { hasOrchestrateKeyword, parseBodydouble, spoonsBlockReason } from "../extensions/text.ts";

test("orchestrate keyword only in prose", () => {
	assert.ok(hasOrchestrateKeyword("orchestrate add a --version flag"));
	assert.ok(hasOrchestrateKeyword("please orchestrate this."));
	assert.ok(!hasOrchestrateKeyword("call `orchestrate` here"));
	assert.ok(!hasOrchestrateKeyword("```\norchestrate\n```"));
	assert.ok(!hasOrchestrateKeyword("see src/orchestrate.ts"));
	assert.ok(!hasOrchestrateKeyword("orchestrated it already"));
	assert.ok(!hasOrchestrateKeyword("Orchestrate"));
});

test("body double verdict parsing", () => {
	assert.equal(parseBodydouble("note: on track"), undefined);
	assert.equal(parseBodydouble(""), undefined);
	assert.deepEqual(parseBodydouble("concern: catch narrowed to ENOENT"), { severity: "concern", text: "catch narrowed to ENOENT" });
	assert.deepEqual(parseBodydouble("thinking...\n**Blocker** - x"), undefined);
	assert.deepEqual(parseBodydouble("> blocker: deletes user data"), { severity: "blocker", text: "deletes user data" });
});

test("spoons gate", () => {
	assert.equal(spoonsBlockReason(5, 0), undefined);
	assert.equal(spoonsBlockReason(5, -1), undefined);
	assert.equal(spoonsBlockReason(0.99, 1), undefined);
	assert.equal(
		spoonsBlockReason(1, 1),
		"nd-crew spoons are spent: $1.0000 of $1.00 budget. Ask the user to raise it with /nd spoons <usd> before delegating more.",
	);
	assert.equal(
		spoonsBlockReason(1.23456, 1),
		"nd-crew spoons are spent: $1.2346 of $1.00 budget. Ask the user to raise it with /nd spoons <usd> before delegating more.",
	);
});
