import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Minion } from "../extensions/fleet.ts";
import { fmtDur, fmtUsd, packMinions, phaseStatuses, renderFooter, renderHud, sprite, type FooterModel, type ThemeLike } from "../extensions/render.ts";

const plain: ThemeLike = { fg: (_c, t) => t, bold: (t) => t };
const opts = { frame: 0, calm: false, ascii: false, now: 100_000 };

function minion(over: Partial<Minion>): Minion {
	return {
		key: over.agent ?? "m",
		agent: "pattern",
		source: "fg",
		state: "reading",
		startedAt: 59_000,
		toolCount: 3,
		turns: 1,
		input: 41_300,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0.0812,
		costExact: false,
		editsSincePlanRead: 0,
		...over,
	};
}

const model: FooterModel = {
	main: { model: "openai/gpt-6.1-sol", thinking: "medium", streaming: true, ctxTokens: 82_410, ctxWindow: 200_000, ctxPercent: 41.2, cost: 1.231, input: 61_200, output: 9_100, cacheRead: 0, cacheHit: 0.71, turn: 7, kidsExact: true, kidsCost: 0.412 },
	minions: [
		minion({ key: "a", agent: "pattern", state: "done", endedAt: 100_000, lastLine: "2 inconsistencies", cost: 0.0102, costExact: true }),
		minion({ key: "b", agent: "hyperfocus", state: "editing", currentTool: "edit", currentArgs: "src/cli.ts:88" }),
		minion({ key: "c", agent: "literal", state: "reading", currentTool: "read", currentArgs: "diff" }),
	],
	budgetUsd: 5,
	orchestrate: true,
	bodydouble: true,
};

test("formatters are exact", () => {
	assert.equal(fmtUsd(0.08123), "$0.0812");
	assert.equal(fmtUsd(0.08123, false), "≈$0.0812");
	assert.equal(fmtDur(252_000), "4:12");
	assert.equal(fmtDur(3_725_000), "1:02:05");
});

test("sprites animate unless calm", () => {
	const a = sprite("thinking", { frame: 0, calm: false, ascii: false });
	const b = sprite("thinking", { frame: 1, calm: false, ascii: false });
	assert.notEqual(a, b);
	assert.equal(sprite("thinking", { frame: 1, calm: true, ascii: false }), a);
	assert.equal(sprite("done", { frame: 3, calm: false, ascii: true }), ":D");
});

for (const width of [160, 120, 90, 70, 50]) {
	test(`footer fits ${width} cols and stays within 3 lines`, () => {
		const lines = renderFooter(model, width, plain, opts);
		assert.ok(lines.length >= 1 && lines.length <= 3, `got ${lines.length} lines`);
		for (const l of lines) assert.ok(visibleWidth(l) <= width, `line too wide (${visibleWidth(l)}): ${l}`);
	});
}

test("wide footer shows main stats and each worker's activity", () => {
	const [main, ...rest] = renderFooter(model, 200, plain, opts);
	assert.match(main!, /main gpt-6\.1-sol\/med/);
	assert.match(main!, /82,410\/200\.0k/);
	assert.match(main!, /\$1\.2310 \+\$0\.4120 kids/);
	assert.match(main!, /cache 71%/);
	assert.match(main!, /🥄/);
	const minions = rest.join("\n");
	assert.match(minions, /hyperfocus .*edit src\/cli\.ts:88/);
	assert.match(minions, /literal .*read diff/);
	assert.match(minions, /pattern .*\$0\.0812|pattern .*2 inconsistencies/);
	// live minions are listed before finished ones
	assert.ok(minions.indexOf("hyperfocus") < minions.indexOf("pattern"));
});

test("body-double note takes the third line", () => {
	const lines = renderFooter({ ...model, note: { severity: "concern", text: "catch narrowed to ENOENT" } }, 160, plain, opts);
	assert.equal(lines.length, 3);
	assert.match(lines[2]!, /bodydouble concern: catch narrowed/);
});

test("overflow is reported, not dropped silently", () => {
	const many = Array.from({ length: 12 }, (_, i) => minion({ key: `k${i}`, agent: "hyperfocus" }));
	const lines = packMinions(many, 90, 1, plain, opts);
	assert.equal(lines.length, 1);
	assert.match(lines[0]!, /\+\d+ more/);
});

test("phase strip tracks the crew", () => {
	const statuses = phaseStatuses(model.minions);
	assert.deepEqual(
		statuses.map((s) => s.status),
		["done", "pending", "active", "active"],
	);
	const hud = renderHud({ minions: model.minions, budgetUsd: 5, spent: 1, parkingLot: 2 }, 120, plain, opts);
	assert.match(hud[0]!, /ANALYSE ✓/);
	assert.match(hud[1]!, /spoons .*80%/);
	assert.match(hud[1]!, /parking-lot 2/);
	assert.match(hud[1]!, /timebox/);
	assert.deepEqual(renderHud({ minions: [], budgetUsd: 0, spent: 0, parkingLot: 0 }, 120, plain, opts), []);
});

test("free text collapses to one clean line", async () => {
	const { oneLine } = await import("../extensions/render.ts");
	assert.equal(oneLine("# Implementation plan\n## Done"), "Implementation plan");
	assert.equal(oneLine("\x1b[31m  red\x1b[0m text\nmore"), "red text");
	assert.equal(oneLine(undefined), "");
	const lines = renderFooter({ ...model, minions: [minion({ state: "done", endedAt: 100_000, lastLine: "# Plan\nstep 1\nstep 2" })] }, 160, plain, opts);
	assert.equal(lines.length, 2);
	assert.match(lines[1]!, /Plan/);
});

test("between tool calls a minion shows what it just did", () => {
	const lines = renderFooter({ ...model, minions: [minion({ state: "thinking", currentTool: undefined, lastTool: "read cli.js" })] }, 200, plain, opts);
	assert.match(lines[1]!, /thinking · after read cli\.js/);
});

test("a stopped phase is not shown as done", () => {
	const statuses = phaseStatuses([minion({ agent: "hyperfocus", state: "killed", endedAt: 1 })]);
	assert.equal(statuses.find((s) => s.phase === "HYPERFOCUS")!.status, "failed");
});

test("at 80 columns live workers still show what they are doing", () => {
	const lines = renderFooter(model, 80, plain, opts);
	assert.match(lines.join("\n"), /edit src\/cli\.ts/);
	for (const l of lines) assert.ok(visibleWidth(l) <= 80);
});

test("cost survives on a 60-column main line", () => {
	const [main] = renderFooter(model, 60, plain, opts);
	assert.match(main!, /\$1\.2310/);
});

test("finished workers shrink to chips before being hidden", () => {
	const crew = [
		minion({ key: "h", agent: "hyperfocus", state: "editing", currentTool: "edit", currentArgs: "src/cli.ts:88" }),
		minion({ key: "l", agent: "literal", state: "reading", currentTool: "read", currentArgs: "src/cli.ts" }),
		minion({ key: "p", agent: "pattern", state: "done", endedAt: 90_000, lastLine: "4 call sites, 1 inconsistency" }),
		minion({ key: "m", agent: "mapper", state: "done", endedAt: 95_000, lastLine: "Plan: 3 steps" }),
	];
	const lines = packMinions(crew, 112, 2, plain, opts);
	const text = lines.join("\n");
	assert.doesNotMatch(text, /more \(alt\+a\)/);
	for (const name of ["hyperfocus", "literal", "pattern", "mapper"]) assert.match(text, new RegExp(name));
});
