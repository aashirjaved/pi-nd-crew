/**
 * Fleet store: one Minion per running or recently finished subagent child.
 *
 * Pure reducers over plain data so they run in tests without Pi.
 * Inputs are pi-subagents shapes (AgentProgress, SingleResult, async events,
 * AsyncStatusSnapshot), read defensively because they are another package's contract.
 */

export type MinionState =
	| "idle"
	| "reading"
	| "editing"
	| "running"
	| "thinking"
	| "waiting"
	| "done"
	| "failed"
	| "killed";

export const TERMINAL_STATES: ReadonlySet<MinionState> = new Set(["done", "failed", "killed"]);

export interface Minion {
	key: string;
	agent: string;
	source: "fg" | "async";
	runId?: string;
	index?: number;
	state: MinionState;
	startedAt: number;
	endedAt?: number;
	currentTool?: string;
	currentArgs?: string;
	/** Most recent finished tool call, shown while the minion thinks between calls. */
	lastTool?: string;
	toolCount: number;
	turns: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** USD. Exact when `costExact`, otherwise priced from tokens × model rates. */
	cost: number;
	costExact: boolean;
	model?: string;
	thinking?: string;
	/** Edits since the minion last read the plan (hyperfocus drift meter). */
	editsSincePlanRead: number;
	lastLine?: string;
	error?: string;
}

export type Fleet = Map<string, Minion>;

/** Price per million tokens, as in pi-ai's ModelCost. */
export interface Rates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}
export type PriceLookup = (model: string | undefined) => Rates | undefined;

const READ_TOOLS = new Set(["read", "grep", "find", "ls", "glob", "search", "watchdog_diff", "web_search", "fetch"]);
const EDIT_TOOLS = new Set(["edit", "write", "multi_edit", "apply_patch", "notebook_edit"]);
const RUN_TOOLS = new Set(["bash", "powershell", "exec", "codemode"]);
const WAIT_TOOLS = new Set(["contact_supervisor", "ask_user", "question"]);

export function stateForTool(tool: string | undefined): MinionState {
	if (!tool) return "thinking";
	const t = tool.toLowerCase();
	if (READ_TOOLS.has(t)) return "reading";
	if (EDIT_TOOLS.has(t)) return "editing";
	if (RUN_TOOLS.has(t)) return "running";
	if (WAIT_TOOLS.has(t)) return "waiting";
	return "running";
}

export function priceTokens(rates: Rates | undefined, u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
	if (!rates) return 0;
	return (u.input * rates.input + u.output * rates.output + u.cacheRead * rates.cacheRead + u.cacheWrite * rates.cacheWrite) / 1e6;
}

/** pi-subagents reports models as `provider/id:thinking`; keep `provider/id`. */
export const cleanModel = (v: unknown): string | undefined =>
	typeof v === "string" && v.length > 0 ? v.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, "") : undefined;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Count edits after the last read of a plan file in a bounded recent-tools list. */
export function editsSincePlanRead(recentTools: unknown): number {
	if (!Array.isArray(recentTools)) return 0;
	let edits = 0;
	for (const entry of recentTools) {
		const t = rec(entry);
		const tool = String(t.tool ?? "").toLowerCase();
		const args = String(t.args ?? "");
		if (READ_TOOLS.has(tool) && /plan\.md/.test(args)) edits = 0;
		else if (EDIT_TOOLS.has(tool)) edits++;
	}
	return edits;
}

function base(key: string, agent: string, source: Minion["source"], now: number): Minion {
	return {
		key,
		agent,
		source,
		state: "idle",
		startedAt: now,
		toolCount: 0,
		turns: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		costExact: false,
		editsSincePlanRead: 0,
	};
}

function upsert(fleet: Fleet, key: string, agent: string, source: Minion["source"], now: number): Minion {
	let m = fleet.get(key);
	if (!m) {
		m = base(key, agent, source, now);
		fleet.set(key, m);
	}
	return m;
}

const PROGRESS_STATUS: Record<string, MinionState | undefined> = {
	completed: "done",
	failed: "failed",
	detached: "waiting",
};

/**
 * Foreground progress snapshot (tool_execution_update for the `subagent` tool,
 * `partialResult.details.progress`). Snapshots replace, they never merge deltas.
 */
export function applyProgress(fleet: Fleet, toolCallId: string, details: unknown, price: PriceLookup, now = Date.now()): void {
	const d = rec(details);
	const runId = str(d.runId) ?? toolCallId;
	const progress = Array.isArray(d.progress) ? d.progress : [];
	for (const raw of progress) {
		const p = rec(raw);
		const index = num(p.index);
		const agent = str(p.agent) ?? "subagent";
		const m = upsert(fleet, `${runId}#${index}`, agent, "fg", now - num(p.durationMs));
		m.runId = runId;
		m.index = index;
		m.agent = agent;
		m.currentTool = str(p.currentTool);
		m.currentArgs = str(p.currentToolArgs) ?? str(p.currentPath);
		m.toolCount = num(p.toolCount);
		m.turns = num(p.turnCount);
		m.model = cleanModel(p.model) ?? m.model;
		m.thinking = str(p.thinking) ?? m.thinking;
		m.input = num(p.inputTokens);
		m.output = num(p.outputTokens);
		m.cacheRead = num(p.cacheRead);
		m.cacheWrite = num(p.cacheWrite);
		if (!m.input && !m.output) m.input = num(p.tokens);
		if (!m.costExact) m.cost = priceTokens(price(m.model), m);
		m.editsSincePlanRead = editsSincePlanRead(p.recentTools);
		const recent = Array.isArray(p.recentTools) ? p.recentTools.map(rec) : [];
		const last = recent[recent.length - 1];
		if (last) m.lastTool = `${String(last.tool ?? "")} ${String(last.args ?? "")}`.trim();
		const out = Array.isArray(p.recentOutput) ? p.recentOutput : [];
		m.lastLine = str(out[out.length - 1]) ?? m.lastLine;
		m.error = str(p.error);
		const status = str(p.status);
		m.state = (status ? PROGRESS_STATUS[status] : undefined) ?? (status === "pending" ? "idle" : stateForTool(m.currentTool));
		if (TERMINAL_STATES.has(m.state)) m.endedAt ??= now;
	}
}

/** Final foreground result (`tool_execution_end`, `result.details.results`). Usage here is authoritative. */
export function applyFinal(fleet: Fleet, toolCallId: string, details: unknown, isError: boolean, now = Date.now()): void {
	const d = rec(details);
	const runId = str(d.runId) ?? toolCallId;
	const results = Array.isArray(d.results) ? d.results : [];
	for (const raw of results) {
		const r = rec(raw);
		const index = num(r.index);
		const agent = str(r.agent) ?? "subagent";
		const m = upsert(fleet, `${runId}#${index}`, agent, "fg", now);
		m.runId = runId;
		m.index = index;
		const u = rec(r.usage);
		if (Object.keys(u).length) {
			m.input = num(u.input);
			m.output = num(u.output);
			m.cacheRead = num(u.cacheRead);
			m.cacheWrite = num(u.cacheWrite);
			m.turns = num(u.turns) || m.turns;
			m.cost = num(u.cost);
			m.costExact = true;
		}
		m.model = cleanModel(r.model) ?? m.model;
		m.error = str(r.error);
		m.lastLine = str(r.finalOutput) ?? m.lastLine;
		m.currentTool = undefined;
		m.currentArgs = undefined;
		if (r.detached) {
			// Child paused to ask its supervisor; it finishes later via `subagent:foreground-complete`.
			m.state = "waiting";
			m.lastLine = str(r.detachedReason) ?? "waiting for supervisor";
			m.error = undefined;
			continue;
		}
		const failed = num(r.exitCode) !== 0 || !!r.timedOut || !!m.error;
		m.state = r.stopped || r.interrupted ? "killed" : failed ? "failed" : "done";
		m.endedAt = now;
	}
	// A run that errored before producing result rows: fail any live rows it owns.
	if (isError) {
		for (const m of fleet.values()) {
			if (m.runId === runId && !TERMINAL_STATES.has(m.state) && m.state !== "waiting") {
				m.state = "failed";
				m.endedAt = now;
			}
		}
	}
}

/**
 * An async run's own `status.json` (written by the pi-subagents runner). Carries exact
 * per-step tokens, model and cost, including for runs the RPC cost report does not attribute.
 */
export function applyRunStatus(fleet: Fleet, runId: string, status: unknown): void {
	const s = rec(status);
	const steps = Array.isArray(s.steps) ? s.steps.map(rec) : [];
	steps.forEach((step, index) => {
		const m = fleet.get(`${runId}#${index}`);
		if (!m) return;
		const tokens = rec(step.tokens);
		const cost = rec(step.totalCost);
		if (Object.keys(tokens).length) {
			m.input = num(tokens.input);
			m.output = num(tokens.output);
		}
		if (typeof cost.costUsd === "number") {
			m.cost = cost.costUsd;
			m.costExact = true;
		}
		m.model = cleanModel(step.model) ?? m.model;
	});
}

/** `subagent:foreground-complete`: a detached foreground child finished. */
export function applyForegroundComplete(fleet: Fleet, event: unknown, now = Date.now()): { runId?: string; summary?: string; agent?: string } {
	const e = rec(event);
	const runId = str(e.runId);
	if (!runId) return {};
	const index = num(e.taskIndex);
	const agent = str(e.agent) ?? "subagent";
	const m = upsert(fleet, `${runId}#${index}`, agent, "fg", now);
	m.runId = runId;
	m.index = index;
	const state = str(e.state);
	m.state = e.stopped || e.interrupted || state === "stopped" ? "killed" : e.success === false || state === "failed" ? "failed" : "done";
	m.lastLine = str(e.summary) ?? m.lastLine;
	m.currentTool = undefined;
	m.endedAt = now;
	return { runId, summary: str(e.summary), agent };
}

/** `subagent:async-started` */
export function applyAsyncStarted(fleet: Fleet, event: unknown, now = Date.now()): string | undefined {
	const e = rec(event);
	const id = str(e.id);
	if (!id) return undefined;
	const agents = Array.isArray(e.agents) && e.agents.length ? e.agents.map(String) : str(e.agent) ? [str(e.agent)!] : [];
	if (str(e.mode) === "workflow" || !agents.length) {
		// Children are unknown until status/child-status events arrive; show the workflow itself meanwhile.
		const m = upsert(fleet, `${id}#run`, "workflow", "async", now);
		m.runId = id;
		return id;
	}
	agents.forEach((agent, index) => {
		const m = upsert(fleet, `${id}#${index}`, agent, "async", now);
		m.runId = id;
		m.index = index;
		m.state = "idle";
	});
	return id;
}

/** Workflow step ids (`<workflowRunId>|<stepId>`) mapped to the step's own child-run key. */
const stepAliases = new WeakMap<Fleet, Map<string, string>>();
function aliases(fleet: Fleet): Map<string, string> {
	let a = stepAliases.get(fleet);
	if (!a) stepAliases.set(fleet, (a = new Map()));
	return a;
}

/**
 * `subagent:child-status` (async workflows). Each workflow step runs as its own async run
 * (`childRunId`), so the minion is keyed by that run and the step id becomes an alias.
 */
export function applyChildStatus(fleet: Fleet, event: unknown, now = Date.now()): void {
	const e = rec(event);
	const runId = str(e.runId);
	const agent = str(e.agent);
	if (!runId || !agent) return;
	const childRunId = str(e.childRunId);
	const key = childRunId ? `${childRunId}#0` : `${runId}#${num(e.stepIndex)}`;
	const m = upsert(fleet, key, agent, "async", num(e.ts) || now);
	m.runId = childRunId ?? runId;
	m.index = childRunId ? 0 : num(e.stepIndex);
	m.agent = agent;
	for (const id of [str(e.childId), str(e.workflowKey), String(num(e.stepIndex))]) {
		if (id) aliases(fleet).set(`${runId}|${id}`, key);
	}
	if (e.status === "stopped") {
		m.state = "killed";
		m.endedAt ??= now;
	}
	fleet.delete(`${runId}#run`);
}

/** `data.asyncSnapshot` from the RPC `status` method. */
export function applyAsyncSnapshot(fleet: Fleet, snapshot: unknown, now = Date.now()): void {
	const runs = rec(snapshot).runs;
	if (!Array.isArray(runs)) return;
	for (const rawRun of runs) {
		const run = rec(rawRun);
		const runId = str(run.id);
		if (!runId) continue;
		const hasChildren = Array.isArray(run.children) && run.children.length > 0;
		const isContainer = hasChildren || str(run.kind) === "workflow";
		// A workflow's own node is only shown until its children appear.
		if (hasChildren) fleet.delete(`${runId}#run`);
		const nodes: Record<string, unknown>[] = hasChildren ? (run.children as unknown[]).map(rec) : [run];
		nodes.forEach((node, index) => {
			const stepKey =
				aliases(fleet).get(`${runId}|${str(node.id) ?? ""}`) ?? aliases(fleet).get(`${runId}|${index}`) ?? `${runId}#${index}`;
			const key = isContainer && !hasChildren ? `${runId}#run` : hasChildren ? stepKey : `${runId}#${index}`;
			const existing = fleet.get(key);
			const label = str(node.label);
			const agent = existing && existing.agent !== "subagent" && existing.agent !== "workflow" ? existing.agent : (label ?? "subagent");
			const m = upsert(fleet, key, agent, "async", num(node.startedAt) || now);
			m.runId ??= runId;
			m.index ??= index;
			const act = rec(node.activity);
			m.currentTool = str(act.currentTool);
			m.toolCount = num(act.toolCount) || m.toolCount;
			m.turns = num(act.turnCount) || m.turns;
			const state = str(node.state);
			if (state === "complete") m.state = "done";
			else if (state === "failed" || state === "rejected") m.state = "failed";
			else if (state === "stopped") m.state = "killed";
			else if (state === "paused") m.state = "waiting";
			else if (state === "queued") m.state = "idle";
			else m.state = stateForTool(m.currentTool);
			if (TERMINAL_STATES.has(m.state)) m.endedAt ??= num(node.endedAt) || now;
		});
	}
}

/** `data.fleet.entries` from RPC `status`: token totals for async children, matched by agent name. */
export function applyFleetTokens(fleet: Fleet, fleetDto: unknown, price: PriceLookup): void {
	const entries = rec(fleetDto).entries;
	if (!Array.isArray(entries)) return;
	const live = [...fleet.values()].filter((m) => m.source === "async" && !m.costExact);
	for (const raw of entries) {
		const e = rec(raw);
		const m = live.find((x) => x.agent === str(e.agent));
		if (!m) continue;
		const t = rec(e.tokens);
		m.input = num(t.input);
		m.output = num(t.output);
		m.model = cleanModel(e.model) ?? m.model;
		m.thinking = str(e.effort) ?? m.thinking;
		m.cost = priceTokens(price(m.model), m);
	}
}

/** `subagent:async-complete`. Returns the completed run id and the first child's summary text. */
export function applyAsyncComplete(fleet: Fleet, event: unknown, now = Date.now()): { runId?: string; summary?: string; agent?: string } {
	const e = rec(event);
	const runId = str(e.runId) ?? str(e.id);
	if (!runId) return {};
	const results = Array.isArray(e.results) ? e.results.map(rec) : [];
	const ok = e.success !== false && str(e.state) !== "failed";
	let summary = str(e.summary) ?? str(e.output);
	let agent = str(e.agent);
	for (const m of fleet.values()) {
		if (m.runId !== runId) continue;
		const r = results.find((x) => num(x.index) === m.index) ?? results[m.index ?? 0];
		const status = str(r?.status);
		if (TERMINAL_STATES.has(m.state) && !r) continue;
		m.state = status === "failed" || (!r && !ok) ? "failed" : status === "stopped" ? "killed" : "done";
		const u = rec(r?.usage);
		if (Object.keys(u).length) {
			m.input = num(u.input);
			m.output = num(u.output);
			m.cacheRead = num(u.cacheRead);
			m.cacheWrite = num(u.cacheWrite);
			m.cost = num(u.cost);
			m.costExact = true;
		}
		m.lastLine = str(r?.summary) ?? m.lastLine;
		summary ??= str(r?.summary);
		agent ??= m.agent;
		m.currentTool = undefined;
		m.endedAt ??= now;
	}
	return { runId, summary, agent };
}

/** Exact child costs from RPC `cost` (`children[]` with runId + usage). */
export function applyCostReport(fleet: Fleet, report: unknown): { childTotal: number; exact: boolean } {
	const r = rec(report);
	const children = Array.isArray(r.children) ? r.children.map(rec) : [];
	for (const c of children) {
		const runId = str(c.runId);
		const u = rec(c.usage);
		const m = [...fleet.values()].find((x) => x.runId === runId && (str(c.agent) === undefined || x.agent === str(c.agent)));
		if (!m || !Object.keys(u).length) continue;
		m.cost = num(u.cost);
		m.costExact = true;
	}
	const childTotal = typeof r.childTotal === "number" ? r.childTotal : num(rec(r.childTotal).cost);
	return { childTotal, exact: num(r.unresolvedAsyncChildren) === 0 };
}

/**
 * Drop finished minions. While anything is live the whole batch stays (capped at `max`),
 * so the phase strip never forgets a phase mid-run. Once idle, the batch ages out together.
 */
export function prune(fleet: Fleet, now = Date.now(), keepMs = 120_000, max = 8): void {
	const finished = [...fleet.values()]
		.filter((m) => TERMINAL_STATES.has(m.state))
		.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
	const live = finished.length < fleet.size;
	const lastEnd = finished[0]?.endedAt ?? now;
	finished.forEach((m, i) => {
		if (i >= max || (!live && now - lastEnd > keepMs)) fleet.delete(m.key);
	});
}

export function activeCount(fleet: Fleet): number {
	let n = 0;
	for (const m of fleet.values()) if (!TERMINAL_STATES.has(m.state)) n++;
	return n;
}

export function fleetCost(fleet: Fleet): number {
	let c = 0;
	for (const m of fleet.values()) c += m.cost;
	return c;
}
