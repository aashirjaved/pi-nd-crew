import assert from "node:assert/strict";
import { test } from "node:test";
import {
	applyAsyncComplete,
	applyAsyncSnapshot,
	applyAsyncStarted,
	applyChildStatus,
	applyCostReport,
	applyFinal,
	applyForegroundComplete,
	applyProgress,
	editsSincePlanRead,
	prune,
	stateForTool,
	type Fleet,
} from "../extensions/fleet.ts";

const price = () => ({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });

test("tool names map to minion states", () => {
	assert.equal(stateForTool("read"), "reading");
	assert.equal(stateForTool("edit"), "editing");
	assert.equal(stateForTool("bash"), "running");
	assert.equal(stateForTool("contact_supervisor"), "waiting");
	assert.equal(stateForTool(undefined), "thinking");
});

test("hyperfocus drift meter resets on a plan read", () => {
	const tools = [
		{ tool: "edit", args: "a.ts" },
		{ tool: "read", args: ".pi/nd-crew/plan.md" },
		{ tool: "edit", args: "b.ts" },
		{ tool: "write", args: "c.ts" },
	];
	assert.equal(editsSincePlanRead(tools), 2);
	assert.equal(editsSincePlanRead(undefined), 0);
});

test("foreground progress then final result", () => {
	const fleet: Fleet = new Map();
	applyProgress(
		fleet,
		"call-1",
		{
			runId: "run-1",
			progress: [
				{ index: 0, agent: "hyperfocus", status: "running", currentTool: "edit", currentToolArgs: "src/cli.ts", toolCount: 4, inputTokens: 1_000_000, outputTokens: 0, durationMs: 5000, recentTools: [], recentOutput: ["ok"] },
			],
		},
		price,
		10_000,
	);
	const m = fleet.get("run-1#0")!;
	assert.equal(m.state, "editing");
	assert.equal(m.startedAt, 5000);
	assert.equal(m.cost, 3); // 1M input tokens at $3/M
	assert.equal(m.costExact, false);

	applyFinal(fleet, "call-1", { runId: "run-1", results: [{ index: 0, agent: "hyperfocus", exitCode: 0, usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.0123, turns: 3 } }] }, false, 20_000);
	assert.equal(m.state, "done");
	assert.equal(m.cost, 0.0123);
	assert.equal(m.costExact, true);
	assert.equal(m.endedAt, 20_000);
});

test("errored foreground run fails its live rows", () => {
	const fleet: Fleet = new Map();
	applyProgress(fleet, "c", { progress: [{ index: 0, agent: "pattern", status: "running" }] }, price, 1);
	applyFinal(fleet, "c", {}, true, 2);
	assert.equal(fleet.get("c#0")!.state, "failed");
});

test("async lifecycle: started, snapshot, cost, complete", () => {
	const fleet: Fleet = new Map();
	assert.equal(applyAsyncStarted(fleet, { id: "a1", agent: "bodydouble" }, 100), "a1");
	applyAsyncSnapshot(fleet, { runs: [{ id: "a1", state: "running", activity: { currentTool: "grep", toolCount: 2 } }] }, 200);
	assert.equal(fleet.get("a1#0")!.state, "reading");
	const { childTotal, exact } = applyCostReport(fleet, { children: [{ runId: "a1", agent: "bodydouble", usage: { cost: 0.5 } }], childTotal: { cost: 0.5 }, unresolvedAsyncChildren: 0 });
	assert.equal(childTotal, 0.5);
	assert.equal(exact, true);
	assert.equal(fleet.get("a1#0")!.cost, 0.5);
	const done = applyAsyncComplete(fleet, { runId: "a1", success: true, results: [{ index: 0, status: "completed", summary: "concern: tests skipped" }] }, 300);
	assert.equal(done.summary, "concern: tests skipped");
	assert.equal(done.agent, "bodydouble");
	assert.equal(fleet.get("a1#0")!.state, "done");
});

test("prune keeps live minions and recent finished ones", () => {
	const fleet: Fleet = new Map();
	applyAsyncStarted(fleet, { id: "live", agent: "pattern" }, 0);
	applyAsyncStarted(fleet, { id: "old", agent: "pattern" }, 0);
	applyAsyncComplete(fleet, { runId: "old", success: true }, 0);
	prune(fleet, 500_000);
	assert.ok(fleet.has("live#0"));
	assert.ok(fleet.has("old#0"), "kept: its batch is still running");
	for (let i = 0; i < 10; i++) {
		applyAsyncStarted(fleet, { id: `x${i}`, agent: "pattern" }, i);
		applyAsyncComplete(fleet, { runId: `x${i}`, success: true }, 10 + i);
	}
	prune(fleet, 500_000);
	assert.equal(fleet.size, 9, "live one plus at most 8 finished");
});

test("detached child waits for its supervisor, then completes", () => {
	const fleet: Fleet = new Map();
	applyProgress(fleet, "c", { runId: "r", progress: [{ index: 0, agent: "pattern", status: "running" }] }, price, 1);
	applyFinal(fleet, "c", { runId: "r", results: [{ index: 0, agent: "pattern", exitCode: 1, detached: true, detachedReason: "asked supervisor" }] }, false, 2);
	assert.equal(fleet.get("r#0")!.state, "waiting");
	applyForegroundComplete(fleet, { runId: "r", taskIndex: 0, agent: "pattern", success: true, summary: "8 files", state: "complete" }, 3);
	assert.equal(fleet.get("r#0")!.state, "done");
	assert.equal(fleet.get("r#0")!.lastLine, "8 files");
});

test("workflow run shows itself until children are known, then personas take over", () => {
	const fleet: Fleet = new Map();
	applyAsyncStarted(fleet, { id: "w", mode: "workflow", agents: [] }, 0);
	assert.equal(fleet.get("w#run")!.agent, "workflow");
	applyChildStatus(fleet, { runId: "w", stepIndex: 0, agent: "pattern", status: "started" }, 1);
	assert.ok(!fleet.has("w#run"));
	applyAsyncSnapshot(fleet, { runs: [{ id: "w", kind: "workflow", state: "running", children: [{ id: "c0", label: "pattern", state: "running", activity: { currentTool: "read" } }, { id: "c1", label: "mapper", state: "queued" }] }] }, 2);
	assert.equal(fleet.get("w#0")!.agent, "pattern");
	assert.equal(fleet.get("w#0")!.state, "reading");
	assert.equal(fleet.get("w#1")!.agent, "mapper");
	assert.equal(fleet.get("w#1")!.state, "idle");
});

test("replaying a real /ship run yields one minion per persona step, all done", async () => {
	const { readFileSync } = await import("node:fs");
	const fleet: Fleet = new Map();
	const lines = readFileSync(new URL("./fixtures/ship-events.jsonl", import.meta.url), "utf8").trim().split("\n");
	for (const line of lines) {
		const { t, kind, data } = JSON.parse(line);
		if (kind === "subagent:async-started") applyAsyncStarted(fleet, data, t);
		else if (kind === "subagent:child-status") applyChildStatus(fleet, data, t);
		else if (kind === "subagent:async-complete") applyAsyncComplete(fleet, data, t);
		else if (kind === "status") applyAsyncSnapshot(fleet, data.asyncSnapshot, t);
	}
	const agents = [...fleet.values()].map((m) => m.agent).sort();
	assert.deepEqual(agents, ["hyperfocus", "literal", "mapper", "pattern"]);
	for (const m of fleet.values()) {
		assert.equal(m.state, "done", `${m.agent} ${m.state}`);
		assert.ok(m.endedAt! > m.startedAt, `${m.agent} has a positive duration`);
	}
});

test("model ids drop the thinking suffix", async () => {
	const { cleanModel } = await import("../extensions/fleet.ts");
	assert.equal(cleanModel("openai/gpt-6.1-sol:off"), "openai/gpt-6.1-sol");
	assert.equal(cleanModel("anthropic/claude-sonnet-5"), "anthropic/claude-sonnet-5");
	assert.equal(cleanModel(""), undefined);
});

test("finished minions stay while their batch is still running", () => {
	const fleet: Fleet = new Map();
	applyAsyncStarted(fleet, { id: "a", agent: "pattern" }, 0);
	applyAsyncComplete(fleet, { runId: "a", success: true }, 1_000);
	applyAsyncStarted(fleet, { id: "b", agent: "hyperfocus" }, 2_000);
	prune(fleet, 500_000);
	assert.ok(fleet.has("a#0"), "pattern kept while hyperfocus runs");
	applyAsyncComplete(fleet, { runId: "b", success: true }, 600_000);
	prune(fleet, 650_000);
	assert.equal(fleet.size, 2, "batch kept shortly after it ends");
	prune(fleet, 800_000);
	assert.equal(fleet.size, 0, "batch ages out together");
});

test("run status.json gives exact cost and tokens for background runs", async () => {
	const { applyRunStatus } = await import("../extensions/fleet.ts");
	const fleet: Fleet = new Map();
	applyAsyncStarted(fleet, { id: "r", agent: "hyperfocus" }, 0);
	applyRunStatus(fleet, "r", { steps: [{ model: "openai/gpt-6.1-sol:medium", tokens: { input: 27929, output: 1286 }, totalCost: { costUsd: 0.0421 } }] });
	const m = fleet.get("r#0")!;
	assert.equal(m.input, 27929);
	assert.equal(m.cost, 0.0421);
	assert.equal(m.costExact, true);
	assert.equal(m.model, "openai/gpt-6.1-sol");
});
