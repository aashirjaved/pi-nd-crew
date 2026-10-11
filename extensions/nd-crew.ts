/**
 * nd-crew: neurodivergent crew for Pi.
 *
 * - Registers five persona subagents with pi-subagents at runtime (no files to copy).
 * - Replaces the footer with an animated "minions" status line: main-session model, context,
 *   exact cost and cache, plus one sprite per running subagent with what it is doing right now.
 * - Phase HUD above the editor, orchestrate mode, body double, spoons budget, /ship workflow, fleet overlay.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { loadConfig, type NdConfig } from "./config.ts";
import { PARKING_LOT_PATH, PERSONAS, personaFor } from "./crew.ts";
import {
	activeCount,
	applyAsyncComplete,
	applyAsyncSnapshot,
	applyAsyncStarted,
	applyChildStatus,
	applyCostReport,
	applyFinal,
	applyFleetTokens,
	applyForegroundComplete,
	applyProgress,
	applyRunStatus,
	fleetCost,
	prune,
	type Fleet,
	type Rates,
} from "./fleet.ts";
import { FleetOverlay, type OverlayAction } from "./overlay.ts";
import { renderFooter, renderHud, type Color, type MainStats, type Note, type RenderOpts, type ThemeLike } from "./render.ts";
import { SubagentsRpc } from "./rpc.ts";
import { hasOrchestrateKeyword, ORCHESTRATE_PROMPT, parseBodydouble, spoonsBlockReason } from "./text.ts";

const STATE_ENTRY = "nd-crew-state";
const SHIP_WORKFLOW = fileURLToPath(new URL("../workflows/ship.js", import.meta.url));
const REGISTER_EVENT = "pi-subagents:runtime-agent-register:v1";

interface PersistedState {
	orchestrate: boolean;
	bodydouble: boolean;
	budgetUsd: number;
	calm: boolean;
	ascii: boolean;
	hud: boolean;
}

interface AssistantLike {
	role: string;
	usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } };
}

/** NDCREW_DEBUG=/path/file.jsonl logs raw pi-subagents payloads for troubleshooting. */
const debug = (kind: string, data: unknown): void => {
	const path = process.env.NDCREW_DEBUG;
	if (!path) return;
	try {
		appendFileSync(path, `${JSON.stringify({ t: Date.now(), kind, data })}\n`);
	} catch {
		// debugging must never break the session
	}
};

const themeLike = (theme: Theme): ThemeLike => ({
	fg: (color: Color, text: string) => theme.fg(color, text),
	bold: (text: string) => theme.bold(text),
});

export default function ndCrew(pi: ExtensionAPI): void {
	const rpc = new SubagentsRpc(pi);
	const fleet: Fleet = new Map();
	let cfg: NdConfig = loadConfig(process.cwd());
	let state: PersistedState = { orchestrate: cfg.orchestrate, bodydouble: cfg.bodydouble, budgetUsd: cfg.budgetUsd, calm: cfg.calm, ascii: cfg.ascii, hud: cfg.hud };
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;
	let frame = 0;
	let ticker: ReturnType<typeof setInterval> | undefined;
	let poller: ReturnType<typeof setInterval> | undefined;
	let registrations: { dispose(): void }[] = [];
	let crewRegistered = false;
	let note: (Note & { turnsLeft: number }) | undefined;
	let parkingLot = 0;

	const main: MainStats = { streaming: false, cost: 0, input: 0, output: 0, cacheRead: 0, turn: 0, kidsExact: true };

	// ------------------------------------------------------------ helpers

	const opts = (): RenderOpts => ({ frame, calm: state.calm, ascii: state.ascii, now: Date.now() });
	const render = () => tui?.requestRender();

	const priceCache = new Map<string, Rates | undefined>();
	const price = (model: string | undefined): Rates | undefined => {
		if (!model || !ctx) return undefined;
		if (priceCache.has(model)) return priceCache.get(model);
		const slash = model.indexOf("/");
		// Bare ids are ambiguous across providers; prefer the session's provider.
		const sameId = slash > 0 ? [] : ctx.modelRegistry.getAll().filter((m) => m.id === model);
		const found =
			slash > 0
				? ctx.modelRegistry.find(model.slice(0, slash), model.slice(slash + 1))
				: (sameId.find((m) => m.provider === ctx?.model?.provider) ?? (sameId.length === 1 ? sameId[0] : undefined));
		const rates = found?.cost ? { input: found.cost.input, output: found.cost.output, cacheRead: found.cost.cacheRead, cacheWrite: found.cost.cacheWrite } : undefined;
		priceCache.set(model, rates);
		return rates;
	};

	// The RPC cost report misses RPC-spawned runs (/ship, body double); the fleet misses pruned ones.
	const kids = () => Math.max(main.kidsCost ?? 0, fleetCost(fleet));
	const kidsExact = () => main.kidsExact && [...fleet.values()].every((m) => m.costExact);
	const spent = () => main.cost + kids();

	function persist(): void {
		pi.appendEntry(STATE_ENTRY, state);
	}

	function restore(c: ExtensionContext): void {
		cfg = loadConfig(c.cwd);
		state = { orchestrate: cfg.orchestrate, bodydouble: cfg.bodydouble, budgetUsd: cfg.budgetUsd, calm: cfg.calm, ascii: cfg.ascii, hud: cfg.hud };
		for (const entry of c.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === STATE_ENTRY && entry.data && typeof entry.data === "object") {
				state = { ...state, ...(entry.data as Partial<PersistedState>) };
			}
		}
		if (process.env.NO_COLOR || process.env.PI_REDUCED_MOTION === "1") state.calm = true;
	}

	function recomputeMain(): void {
		if (!ctx) return;
		let input = 0, output = 0, cacheRead = 0, cost = 0, turns = 0;
		let last: AssistantLike["usage"];
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message as unknown as AssistantLike;
			if (msg.role !== "assistant" || !msg.usage) continue;
			turns++;
			input += msg.usage.input ?? 0;
			output += msg.usage.output ?? 0;
			cacheRead += msg.usage.cacheRead ?? 0;
			cost += msg.usage.cost?.total ?? 0;
			last = msg.usage;
		}
		Object.assign(main, { input, output, cacheRead, cost, turn: turns });
		if (last) {
			const denom = (last.input ?? 0) + (last.cacheRead ?? 0);
			main.cacheHit = denom > 0 ? (last.cacheRead ?? 0) / denom : undefined;
		}
		const usage = ctx.getContextUsage();
		main.ctxTokens = usage?.tokens ?? null;
		main.ctxWindow = usage?.contextWindow;
		main.ctxPercent = usage?.percent ?? null;
		main.model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
		main.thinking = pi.getThinkingLevel();
	}

	function readParkingLot(): void {
		if (!ctx) return;
		const path = join(ctx.cwd, PARKING_LOT_PATH);
		parkingLot = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).length : 0;
	}

	/** Animate only while something moves. Zero timers when idle or calm. */
	function syncTimers(): void {
		const live = activeCount(fleet) > 0;
		const animate = !state.calm && (live || main.streaming);
		if (animate && !ticker) {
			ticker = setInterval(() => {
				frame++;
				render();
			}, cfg.frameMs);
			ticker.unref?.();
		} else if (!animate && ticker) {
			clearInterval(ticker);
			ticker = undefined;
		}
		const asyncLive = [...fleet.values()].some((m) => m.source === "async" && !["done", "failed", "killed"].includes(m.state));
		if (asyncLive && !poller && rpc.ready) {
			poller = setInterval(() => void pollStatus(), 1000);
			poller.unref?.();
		} else if (!asyncLive && poller) {
			clearInterval(poller);
			poller = undefined;
		}
		render();
	}

	/** asyncDir per background run id, from `subagent:async-started`. */
	const asyncDirs = new Map<string, string>();
	function readRunStatuses(onlyLive: boolean): void {
		for (const [runId, dir] of asyncDirs) {
			const live = [...fleet.values()].some((m) => m.runId === runId && !["done", "failed", "killed"].includes(m.state));
			if (onlyLive && !live) continue;
			try {
				applyRunStatus(fleet, runId, JSON.parse(readFileSync(join(dir, "status.json"), "utf8")));
			} catch {
				// not written yet, or already cleaned up
			}
			if (!live) asyncDirs.delete(runId);
		}
	}

	async function pollStatus(): Promise<void> {
		readRunStatuses(true);
		try {
			const data = await rpc.call<{ asyncSnapshot?: unknown; fleet?: unknown }>("status", {}, 3000);
			debug("status", { asyncSnapshot: data?.asyncSnapshot, fleet: data?.fleet });
			applyAsyncSnapshot(fleet, data?.asyncSnapshot);
			applyFleetTokens(fleet, data?.fleet, price);
		} catch {
			// status is best effort; events still drive the minions
		}
		syncTimers();
	}

	async function refreshCost(): Promise<void> {
		if (!rpc.ready) return;
		try {
			const report = await rpc.call("cost", {}, 5000);
			debug("cost", report);
			const { childTotal, exact } = applyCostReport(fleet, report);
			main.kidsCost = childTotal;
			main.kidsExact = exact;
		} catch {
			main.kidsCost = undefined;
		}
		render();
	}

	function registerCrew(): void {
		if (crewRegistered) return;
		const failures: string[] = [];
		for (const p of PERSONAS) {
			const request: { version: 1; name: string; definition: Record<string, unknown>; result?: { ok: true; registration: { dispose(): void } } | { ok: false; error: Error } } = {
				version: 1,
				name: p.name,
				definition: {
					description: `${p.role} (${p.trait}). ${p.description}`,
					systemPrompt: p.systemPrompt,
					aliases: p.aliases,
					tools: p.tools,
					thinking: cfg.thinking[p.name] ?? p.thinking,
					...(cfg.models[p.name] ? { model: cfg.models[p.name] } : {}),
					systemPromptMode: "replace",
					inheritProjectContext: p.inheritProjectContext,
					inheritSkills: false,
					acceptanceRole: p.acceptanceRole,
					...(p.timeoutMs ? { defaultTimeoutMs: p.timeoutMs } : {}),
					...(p.defaultAsync ? { defaultAsync: true } : {}),
				},
			};
			pi.events.emit(REGISTER_EVENT, request);
			if (!request.result) return; // pi-subagents not loaded (yet); retry later
			if (request.result.ok) registrations.push(request.result.registration);
			else failures.push(`${p.name}: ${request.result.error.message}`);
		}
		crewRegistered = true;
		if (failures.length) ctx?.ui.notify(`nd-crew: some personas failed to register\n${failures.join("\n")}`, "warning");
	}

	function disposeCrew(): void {
		for (const r of registrations) {
			try {
				r.dispose();
			} catch {
				// already gone
			}
		}
		registrations = [];
		crewRegistered = false;
	}

	function installUi(c: ExtensionContext): void {
		if (!c.hasUI) return;
		c.ui.setFooter((t, theme) => {
			tui = t;
			const tl = themeLike(theme);
			return {
				dispose() {
					if (tui === t) tui = undefined;
				},
				invalidate() {},
				render: (width: number) => {
					prune(fleet);
					return renderFooter(
						{ main: { ...main, kidsCost: kids(), kidsExact: kidsExact() }, minions: [...fleet.values()], budgetUsd: state.budgetUsd, note, orchestrate: state.orchestrate, bodydouble: state.bodydouble },
						width,
						tl,
						opts(),
					);
				},
			};
		});
		installHud(c);
		c.ui.setWorkingIndicator(
			state.calm
				? { frames: [c.ui.theme.fg("accent", "●")] }
				: { frames: ["·", "•", "●", "◉", "●", "•"].map((f, i) => c.ui.theme.fg(i % 2 ? "accent" : "borderAccent", f)), intervalMs: 110 },
		);
	}

	function installHud(c: ExtensionContext): void {
		if (!c.hasUI) return;
		if (!state.hud) {
			c.ui.setWidget("nd-hud", undefined);
			return;
		}
		c.ui.setWidget(
			"nd-hud",
			(_t, theme) => {
				const tl = themeLike(theme);
				return {
					invalidate() {},
					render: (width: number) =>
						renderHud({ minions: [...fleet.values()], budgetUsd: state.budgetUsd, spent: spent(), parkingLot }, width, tl, opts()),
				};
			},
			{ placement: "aboveEditor" },
		);
	}

	// ------------------------------------------------------------ lifecycle

	pi.on("session_start", async (_e, c) => {
		ctx = c;
		fleet.clear();
		note = undefined;
		priceCache.clear();
		restore(c);
		disposeCrew();
		registerCrew();
		recomputeMain();
		readParkingLot();
		installUi(c);
		void rpc.ping().then(() => {
			registerCrew();
			syncTimers();
		});
	});

	pi.on("session_shutdown", async () => {
		disposeCrew();
		if (ticker) clearInterval(ticker);
		if (poller) clearInterval(poller);
		ticker = poller = undefined;
		tui = undefined;
	});

	pi.on("model_select", async (_e, c) => {
		ctx = c;
		recomputeMain();
		render();
	});
	pi.on("thinking_level_select", async () => {
		recomputeMain();
		render();
	});

	pi.on("agent_start", async (_e, c) => {
		ctx = c;
		main.streaming = true;
		syncTimers();
	});

	pi.on("turn_start", async () => {
		if (note && --note.turnsLeft <= 0) note = undefined;
	});

	pi.on("message_end", async (_e, c) => {
		ctx = c;
		recomputeMain();
		render();
	});

	const toolArgs = new Map<string, unknown>();
	pi.on("tool_execution_start", async (e) => {
		if (e.parentToolCallId) return;
		main.currentTool = e.toolName;
		if (e.toolName === "edit" || e.toolName === "write") toolArgs.set(e.toolCallId, e.args);
	});

	pi.on("tool_execution_update", async (e) => {
		if (e.toolName !== "subagent") return;
		applyProgress(fleet, e.toolCallId, (e.partialResult as { details?: unknown } | undefined)?.details, price);
		syncTimers();
	});

	pi.on("tool_execution_end", async (e) => {
		if (!e.parentToolCallId) main.currentTool = undefined;
		if (e.toolName === "subagent") {
			applyFinal(fleet, e.toolCallId, (e.result as { details?: unknown } | undefined)?.details, e.isError);
			syncTimers();
		}
		if (!e.parentToolCallId && (e.toolName === "edit" || e.toolName === "write") && !e.isError) {
			bodydouble.recordChange(e.toolName, toolArgs.get(e.toolCallId), e.result);
		}
		toolArgs.delete(e.toolCallId);
	});

	pi.on("agent_end", async (_e, c) => {
		ctx = c;
		main.streaming = false;
		recomputeMain();
		readParkingLot();
		syncTimers();
		await orchestrate.restoreModel();
		await bodydouble.maybeWatch();
	});

	pi.on("agent_settled", async () => {
		await refreshCost();
	});

	pi.events.on("subagent:async-started", (raw) => {
		debug("subagent:async-started", raw);
		const e = raw as { sessionId?: string };
		if (ctx && e.sessionId && e.sessionId !== ctx.sessionManager.getSessionId()) return;
		const started = raw as { id?: string; asyncDir?: string };
		if (started.id && started.asyncDir) asyncDirs.set(started.id, started.asyncDir);
		applyAsyncStarted(fleet, raw);
		syncTimers();
	});

	pi.events.on("subagent:child-status", (raw) => {
		debug("subagent:child-status", raw);
		applyChildStatus(fleet, raw);
		syncTimers();
	});

	pi.events.on("subagent:foreground-complete", (raw) => {
		debug("subagent:foreground-complete", raw);
		const done = applyForegroundComplete(fleet, raw);
		bodydouble.onComplete(done);
		syncTimers();
		void refreshCost();
	});

	pi.events.on("subagent:async-complete", (raw) => {
		debug("subagent:async-complete", raw);
		const done = applyAsyncComplete(fleet, raw);
		readRunStatuses(false);
		bodydouble.onComplete(done);
		readParkingLot();
		syncTimers();
		void refreshCost();
	});

	// ------------------------------------------------------------ spoons gate

	pi.on("tool_call", async (e) => {
		if (e.toolName !== "subagent" || state.budgetUsd <= 0) return;
		const reason = spoonsBlockReason(spent(), state.budgetUsd);
		if (reason) return { block: true, reason };
	});

	// ------------------------------------------------------------ orchestrate

	const orchestrate = (() => {
		let previousModel: ExtensionContext["model"];
		return {
			async restoreModel() {
				if (!previousModel) return;
				const m = previousModel;
				previousModel = undefined;
				await pi.setModel(m);
			},
			async onPrompt(prompt: string, c: ExtensionContext): Promise<boolean> {
				const active = state.orchestrate || hasOrchestrateKeyword(prompt);
				if (!active) return false;
				if (cfg.parentPlanModel && c.model) {
					const [provider, ...rest] = cfg.parentPlanModel.split("/");
					const plan = c.modelRegistry.find(provider!, rest.join("/"));
					if (plan && plan.id !== c.model.id) {
						previousModel = c.model;
						await pi.setModel(plan);
					}
				}
				return true;
			},
		};
	})();

	pi.on("before_agent_start", async (e, c) => {
		ctx = c;
		bodydouble.onPrompt(e.prompt);
		registerCrew();
		if (!(await orchestrate.onPrompt(e.prompt, c))) return;
		return { systemPrompt: `${e.systemPrompt}\n\n${ORCHESTRATE_PROMPT}` };
	});

	// ------------------------------------------------------------ body double

	const bodydouble = (() => {
		let request = "";
		let changes: { path: string; patch: string; lines: number }[] = [];
		let watchedThisPrompt = false;
		let inFlight: string | undefined;

		return {
			onPrompt(prompt: string) {
				request = prompt;
				changes = [];
				watchedThisPrompt = false;
			},
			recordChange(tool: string, args: unknown, result: unknown) {
				const a = (args ?? {}) as { path?: string; content?: string };
				const details = ((result as { details?: { patch?: string } } | undefined)?.details ?? {}) as { patch?: string };
				const patch = tool === "edit" ? (details.patch ?? "") : (a.content ?? "").split("\n").slice(0, 60).map((l) => `+${l}`).join("\n");
				const lines = patch.split("\n").filter((l) => /^[+-](?![+-]{2})/.test(l)).length;
				changes.push({ path: a.path ?? "?", patch, lines });
			},
			async maybeWatch() {
				if (!state.bodydouble || watchedThisPrompt || inFlight || !rpc.ready || !ctx) return;
				const lines = changes.reduce((a, c) => a + c.lines, 0);
				if (lines < 5) return;
				watchedThisPrompt = true; // ponytail: one body-double check per user prompt; raise if it proves too quiet
				const diff = changes.map((c) => `--- ${c.path}\n${c.patch}`).join("\n").slice(0, 12_000);
				const task = [
					"User request:",
					request.slice(0, 2000),
					"",
					`The main agent changed ${changes.length} file(s), ${lines} line(s). Changes:`,
					diff,
				].join("\n");
				try {
					const data = await rpc.call<Record<string, unknown>>("spawn", { agent: "bodydouble", task, cwd: ctx.cwd, async: true }, 15_000);
					const d = (data ?? {}) as Record<string, unknown>;
					const details = (d.details ?? {}) as Record<string, unknown>;
					inFlight = String(d.runId ?? d.id ?? d.asyncId ?? details.runId ?? details.asyncId ?? "pending");
				} catch (error) {
					ctx.ui.notify(`nd-crew body double could not start: ${(error as Error).message}`, "warning");
				}
			},
			onComplete(done: { runId?: string; summary?: string; agent?: string }) {
				const mine = inFlight && (done.runId === inFlight || (inFlight === "pending" && personaFor(done.agent)?.name === "bodydouble"));
				if (!mine && personaFor(done.agent)?.name !== "bodydouble") return;
				inFlight = undefined;
				const parsed = parseBodydouble(done.summary);
				note = parsed ? { ...parsed, turnsLeft: 2 } : undefined;
				if (parsed?.severity === "blocker") ctx?.ui.notify(`body double blocker: ${parsed.text}`, "error");
			},
		};
	})();

	// ------------------------------------------------------------ fleet overlay

	async function openFleet(c: ExtensionContext): Promise<void> {
		if (!c.hasUI) return;
		const action = await c.ui.custom<OverlayAction>(
			(t, theme, _kb, done) => {
				tui ??= t;
				return new FleetOverlay(() => fleet.values(), themeLike(theme), opts, done);
			},
			{ overlay: true },
		);
		if (action.kind === "stop" && action.minion.runId) {
			try {
				await rpc.call("stop", { id: action.minion.runId, ...(action.minion.index !== undefined ? { index: action.minion.index } : {}) });
				c.ui.notify(`stopping ${action.minion.agent}`, "info");
			} catch (error) {
				c.ui.notify(`stop failed: ${(error as Error).message}`, "error");
			}
		}
		if (action.kind === "steer" && action.minion.runId) {
			const message = await c.ui.input(`Steer ${action.minion.agent}`, "message for the minion");
			if (!message?.trim()) return;
			try {
				await rpc.call("steer", { id: action.minion.runId, message, ...(action.minion.index !== undefined ? { index: action.minion.index } : {}) });
				c.ui.notify(`steered ${action.minion.agent}`, "info");
			} catch (error) {
				c.ui.notify(`steer failed: ${(error as Error).message}`, "error");
			}
		}
	}

	pi.registerShortcut("alt+a", { description: "nd-crew: open the minion fleet", handler: (c) => openFleet(c) });
	pi.registerCommand("fleet", { description: "nd-crew: show every minion with cost, context and what it is doing", handler: async (_a, c) => openFleet(c) });

	// ------------------------------------------------------------ /ship

	pi.registerCommand("ship", {
		description: "nd-crew: pattern → mapper → hyperfocus → literal, up to 3 build/review rounds. Usage: /ship [--worktree] <task>",
		handler: async (args, c) => {
			const worktree = /(^|\s)--worktree(\s|$)/.test(args);
			const task = args.replace(/(^|\s)--worktree(\s|$)/, " ").trim();
			if (!task) return c.ui.notify("Usage: /ship [--worktree] <task>", "warning");
			if (!rpc.ready && !(await rpc.ping())) return c.ui.notify("nd-crew: /ship needs pi-subagents (pi install npm:pi-subagents)", "error");
			registerCrew();
				try {
				await rpc.call("spawn", { workflow: SHIP_WORKFLOW, args: { task, worktree }, cwd: c.cwd, async: true }, 20_000);
				c.ui.notify("nd-crew: ship workflow started. Watch the minions below; alt+a for detail.", "info");
			} catch (error) {
				c.ui.notify(`nd-crew: ship failed to start: ${(error as Error).message}`, "error");
			}
		},
	});

	// ------------------------------------------------------------ /nd

	const HELP = [
		"/nd                     status",
		"/nd crew                personas, traits, models",
		"/nd orchestrate on|off  delegate every prompt to the crew (or say 'orchestrate' in a prompt)",
		"/nd bodydouble on|off   quiet reviewer after edit turns",
		"/nd spoons <usd>|off    session budget; blocks new subagents when spent",
		"/nd calm on|off         stop all animation",
		"/nd ascii on|off        no emoji",
		"/nd hud on|off          phase strip above the editor",
		"/nd parkinglot          show hyperfocus's parked ideas",
		"/nd snapshot [width]    status line as plain text",
		"/ship <task>            full crew workflow",
		"/fleet or alt+a         minion detail, steer, stop",
	].join("\n");

	const onOff = (v: string | undefined, current: boolean): boolean => (v === "on" ? true : v === "off" ? false : !current);

	pi.registerCommand("nd", {
		description: "nd-crew controls: crew, orchestrate, bodydouble, spoons, calm, ascii, hud, parkinglot",
		handler: async (args, c) => {
			const [sub, value] = args.trim().split(/\s+/);
			switch (sub) {
				case undefined:
				case "":
				case "status": {
					const lines = [
						`pi-subagents: ${rpc.ready ? "connected" : "not connected"} · crew registered: ${crewRegistered ? "yes" : "no"}`,
						`orchestrate ${state.orchestrate ? "on" : "off"} · bodydouble ${state.bodydouble ? "on" : "off"} · calm ${state.calm ? "on" : "off"} · ascii ${state.ascii ? "on" : "off"} · hud ${state.hud ? "on" : "off"}`,
						`spent $${spent().toFixed(4)}${state.budgetUsd ? ` of $${state.budgetUsd.toFixed(2)} spoons` : ""} · minions live ${activeCount(fleet)} / shown ${fleet.size}`,
						"",
						HELP,
					];
					return c.ui.notify(lines.join("\n"), "info");
				}
				case "crew":
					return c.ui.notify(
						PERSONAS.map((p) => `${state.ascii ? p.asciiBadge : p.badge} ${p.name} (${p.role}) · ${p.trait}\n   model ${cfg.models[p.name] ?? "pi-subagents default"} · thinking ${cfg.thinking[p.name] ?? p.thinking} · tools ${p.tools.join(",")} · aliases ${p.aliases.join(",")}`).join("\n"),
						"info",
					);
				case "orchestrate":
					state.orchestrate = onOff(value, state.orchestrate);
					break;
				case "bodydouble":
					state.bodydouble = onOff(value, state.bodydouble);
					break;
				case "calm":
					state.calm = onOff(value, state.calm);
					installUi(c);
					break;
				case "ascii":
					state.ascii = onOff(value, state.ascii);
					break;
				case "hud":
					state.hud = onOff(value, state.hud);
					installHud(c);
					break;
				case "spoons": {
					const usd = value === "off" ? 0 : Number(value);
					if (!Number.isFinite(usd) || usd < 0) return c.ui.notify("Usage: /nd spoons <usd>|off", "warning");
					state.budgetUsd = usd;
					break;
				}
				case "snapshot": {
					const plain: ThemeLike = { fg: (_c, t) => t, bold: (t) => t };
					const width = Number(value) || 140;
					const model = { main: { ...main, kidsCost: kids(), kidsExact: kidsExact() }, minions: [...fleet.values()], budgetUsd: state.budgetUsd, note, orchestrate: state.orchestrate, bodydouble: state.bodydouble };
					const hud = renderHud({ minions: model.minions, budgetUsd: state.budgetUsd, spent: spent(), parkingLot }, width, plain, opts());
					return c.ui.notify([...hud, ...renderFooter(model, width, plain, opts())].join("\n"), "info");
				}
				case "parkinglot": {
					const path = join(c.cwd, PARKING_LOT_PATH);
					return c.ui.notify(existsSync(path) ? readFileSync(path, "utf8").trim() || "parking lot is empty" : "parking lot is empty", "info");
				}
				default:
					return c.ui.notify(HELP, "info");
			}
			persist();
			syncTimers();
			c.ui.notify(`nd-crew: ${sub} ${sub === "spoons" ? (state.budgetUsd ? `$${state.budgetUsd}` : "off") : (state as unknown as Record<string, boolean>)[sub!] ? "on" : "off"}`, "info");
		},
	});
}
