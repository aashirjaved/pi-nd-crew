/**
 * Pure rendering for the minions status line and the phase HUD.
 * No Pi runtime imports beyond width helpers, so tests and the preview script can drive it.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { PERSONAS, personaFor } from "./crew.ts";
import { TERMINAL_STATES, type Minion, type MinionState } from "./fleet.ts";

export type Color = "accent" | "success" | "warning" | "error" | "muted" | "dim" | "text" | "borderAccent";
export interface ThemeLike {
	fg(color: Color, text: string): string;
	bold(text: string): string;
}

export interface RenderOpts {
	frame: number;
	calm: boolean;
	ascii: boolean;
	now: number;
}

export interface MainStats {
	model?: string;
	thinking?: string;
	streaming: boolean;
	currentTool?: string;
	ctxTokens?: number | null;
	ctxWindow?: number;
	ctxPercent?: number | null;
	cost: number;
	input: number;
	output: number;
	cacheRead: number;
	/** cacheRead / (input + cacheRead) of the last assistant message, 0..1 */
	cacheHit?: number;
	turn: number;
	/** Exact child total from pi-subagents' cost report, when known. */
	kidsCost?: number;
	kidsExact: boolean;
}

export interface Note {
	severity: "note" | "concern" | "blocker";
	text: string;
}

export interface FooterModel {
	main: MainStats;
	minions: Minion[];
	budgetUsd: number;
	note?: Note;
	orchestrate: boolean;
	bodydouble: boolean;
}

// ---------------------------------------------------------------- formatting

export const fmtInt = (n: number): string => Math.round(n).toLocaleString("en-US");
export function fmtTok(n: number): string {
	if (n < 1000) return `${Math.round(n)}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}
export const fmtUsd = (n: number, exact = true): string => `${exact ? "" : "≈"}$${n.toFixed(4)}`;
export function fmtDur(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, "0");
	return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
export function shortModel(model?: string): string {
	if (!model) return "?";
	const id = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
	return id.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}
const THINK_SHORT: Record<string, string> = { off: "off", minimal: "min", low: "low", medium: "med", high: "high", xhigh: "xhi", max: "max" };

export function bar(fraction: number, cells: number, full = "▰", empty = "▱"): string {
	const f = Math.max(0, Math.min(1, fraction));
	const n = Math.round(f * cells);
	return full.repeat(n) + empty.repeat(cells - n);
}

// ---------------------------------------------------------------- sprites

const FACES: Record<MinionState, string[]> = {
	idle: ["(•‿•)", "(•‿•)", "(-‿-)", "(•‿•)"],
	reading: ["(•_•)📖", "(•_•)📖", "(•o•)📖", "(•_•)📖"],
	editing: ["(⌐■_■)🔨", "(⌐■_■)⚒ ", "(⌐■_■)🔨", "(⌐■_■)⚒ "],
	running: ["(•_•)⚙ ", "(•_•)⚙ ", "(•ᴗ•)⚙ ", "(•_•)⚙ "],
	thinking: ["(•_•)·  ", "(•_•)·· ", "(•_•)···", "(•_•)·· "],
	waiting: ["(-_-)z ", "(-_-)zz", "(-_-)z ", "(-_-)zz"],
	done: ["(^‿^)✓"],
	failed: ["(×_×)✗"],
	killed: ["(x_x)"],
};
const ASCII_FACES: Record<MinionState, string[]> = {
	idle: [":)"],
	reading: [":o", ":O"],
	editing: [":>", ":}"],
	running: [":*", ":+"],
	thinking: [":.", ":..", ":..."],
	waiting: [":z", ":zz"],
	done: [":D"],
	failed: [":("],
	killed: ["x("],
};
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FAST_SPINNER = ["◐", "◓", "◑", "◒"];

export function sprite(state: MinionState, opts: Pick<RenderOpts, "frame" | "calm" | "ascii">, speed = 1): string {
	const frames = (opts.ascii ? ASCII_FACES : FACES)[state];
	const i = opts.calm ? 0 : Math.floor(opts.frame * speed) % frames.length;
	return frames[i]!;
}

const STATE_COLOR: Record<MinionState, Color> = {
	idle: "muted",
	reading: "accent",
	editing: "warning",
	running: "accent",
	thinking: "muted",
	waiting: "dim",
	done: "success",
	failed: "error",
	killed: "dim",
};

function badge(m: Minion, theme: ThemeLike, opts: RenderOpts): string {
	const p = personaFor(m.agent);
	const text = p ? (opts.ascii ? p.asciiBadge : p.badge) : opts.ascii ? "[?]" : "🤖";
	if (p?.name !== "hyperfocus" || TERMINAL_STATES.has(m.state)) return text;
	// Drift meter: the flame heats up as edits pile up without re-reading the plan.
	const heat: Color = m.editsSincePlanRead >= 6 ? "error" : m.editsSincePlanRead >= 3 ? "warning" : "accent";
	const flicker = !opts.calm && heat !== "accent" && opts.frame % 2 === 1;
	return theme.fg(flicker ? "dim" : heat, text);
}

/** First meaningful line of free text: no ANSI, no markdown markers, no newlines. */
export function oneLine(text: string | undefined): string {
	if (!text) return "";
	for (const raw of text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split("\n")) {
		const line = raw.replace(/^[\s#>*|-]+/, "").replace(/\s+/g, " ").trim();
		if (line) return line;
	}
	return "";
}

function doing(m: Minion): string {
	if (m.state === "failed") return oneLine(m.error) || "failed";
	if (TERMINAL_STATES.has(m.state) || m.state === "waiting") return oneLine(m.lastLine);
	if (!m.currentTool) {
		if (m.state === "idle") return "starting";
		return m.lastTool ? `thinking · after ${oneLine(m.lastTool)}` : "thinking";
	}
	const args = oneLine(m.currentArgs);
	return args ? `${m.currentTool} ${args}` : m.currentTool;
}

/** One minion segment. `detail` controls how much is shown (2 = everything). */
export function minionSegment(m: Minion, theme: ThemeLike, opts: RenderOpts, detail: 0 | 1 | 2 = 2): string {
	const speed = personaFor(m.agent)?.name === "hyperfocus" ? 2 : 1; // hyperfocus stims faster
	const face = theme.fg(STATE_COLOR[m.state], sprite(m.state, opts, speed));
	const name = theme.bold(m.agent);
	const elapsed = theme.fg("dim", fmtDur((m.endedAt ?? opts.now) - m.startedAt));
	const parts = [`${badge(m, theme, opts)}${face} ${name} ${elapsed}`];
	if (detail >= 1) parts.push(theme.fg("muted", `${fmtTok(m.input + m.output)} ${fmtUsd(m.cost, m.costExact)}`));
	if (detail >= 2) {
		const what = doing(m);
		if (what) parts.push(theme.fg(m.state === "failed" ? "error" : "text", truncateToWidth(what, 28)));
	}
	return parts.join(" ");
}

// ---------------------------------------------------------------- footer

function ctxColor(pct: number): Color {
	return pct >= 85 ? "error" : pct >= 60 ? "warning" : "success";
}

export function mainLine(model: FooterModel, width: number, theme: ThemeLike, opts: RenderOpts): string {
	const s = model.main;
	const spin = s.streaming
		? theme.fg("accent", opts.calm ? "●" : SPINNER[opts.frame % SPINNER.length]!)
		: theme.fg("dim", "◉");
	const think = s.thinking ? `/${THINK_SHORT[s.thinking] ?? s.thinking}` : "";
	const segs: { text: string; minWidth: number }[] = [];
	segs.push({ text: `${spin} ${theme.bold("main")} ${theme.fg("muted", shortModel(s.model) + think)}`, minWidth: 0 });
	if (s.ctxPercent != null && s.ctxWindow) {
		const pct = s.ctxPercent;
		const tok = s.ctxTokens != null && width >= 100 ? ` ${fmtInt(s.ctxTokens)}/${fmtTok(s.ctxWindow)}` : "";
		segs.push({ text: `ctx ${theme.fg(ctxColor(pct), bar(pct / 100, 8))} ${theme.fg(ctxColor(pct), `${pct.toFixed(1)}%`)}${theme.fg("dim", tok)}`, minWidth: 0 });
	}
	const kids = model.main.kidsCost ?? model.minions.reduce((a, m) => a + m.cost, 0);
	const kidsText = kids > 0 ? ` ${theme.fg("muted", `+${fmtUsd(kids, model.main.kidsExact)} kids`)}` : "";
	segs.push({ text: `${theme.fg("text", fmtUsd(s.cost))}${kidsText}`, minWidth: 0 });
	segs.push({ text: theme.fg("dim", `turn ${s.turn}`), minWidth: 90 });
	const cache = s.cacheHit != null ? ` cache ${Math.round(s.cacheHit * 100)}%` : "";
	segs.push({ text: theme.fg("dim", `in ${fmtTok(s.input)} out ${fmtTok(s.output)}${cache}`), minWidth: 110 });
	if (model.budgetUsd > 0) {
		const left = Math.max(0, 1 - (s.cost + kids) / model.budgetUsd);
		const c: Color = left <= 0 ? "error" : left < 0.2 ? "warning" : "success";
		const spoon = opts.ascii ? "spoons" : "🥄";
		segs.push({ text: theme.fg(c, `${spoon} ${Math.round(left * 100)}%`), minWidth: 0 });
	}
	const flags = [model.orchestrate ? "orch" : "", model.bodydouble ? (opts.ascii ? "bd" : "👁") : ""].filter(Boolean).join(" ");
	if (flags) segs.push({ text: theme.fg("accent", flags), minWidth: 70 });
	const line = segs.filter((x) => width >= x.minWidth).map((x) => x.text).join("  ");
	return truncateToWidth(line, width);
}

function noteLine(note: Note, width: number, theme: ThemeLike, opts: RenderOpts): string {
	const color: Color = note.severity === "blocker" ? "error" : note.severity === "concern" ? "warning" : "muted";
	const eye = opts.ascii ? "[B]" : "👁";
	return truncateToWidth(theme.fg(color, `${eye} bodydouble ${note.severity}: ${note.text}`), width);
}

/** Pack minion segments into at most `maxLines` lines. */
export function packMinions(minions: Minion[], width: number, maxLines: number, theme: ThemeLike, opts: RenderOpts): string[] {
	if (!minions.length || maxLines <= 0) return [];
	const gap = "   ";
	const pack = (finishedDetail: 0 | 2) => {
		// Live workers always say what they are doing; finished ones can shrink to chips.
		const lines: string[] = [];
		let cur = "";
		let shown = 0;
		for (const m of minions) {
			const seg = minionSegment(m, theme, opts, TERMINAL_STATES.has(m.state) ? finishedDetail : 2);
			if (cur && visibleWidth(cur + gap + seg) > width) {
				lines.push(cur);
				cur = "";
				if (lines.length >= maxLines) break;
			}
			cur = cur ? cur + gap + seg : seg;
			shown++;
		}
		if (cur) lines.push(cur);
		return { lines, hidden: minions.length - shown };
	};
	let { lines, hidden } = pack(width >= 100 ? 2 : 0);
	if (hidden > 0 && width >= 100) ({ lines, hidden } = pack(0));
	if (hidden > 0) {
		const more = theme.fg("dim", ` +${hidden} more (alt+a)`);
		const last = lines.length - 1;
		lines[last] = truncateToWidth(lines[last]!, Math.max(0, width - visibleWidth(more))) + more;
	}
	return lines.map((l) => truncateToWidth(l, width));
}

/** Order: live first (most recent start first), then finished (most recent end first). */
export function orderMinions(minions: Iterable<Minion>): Minion[] {
	return [...minions].sort((a, b) => {
		const at = TERMINAL_STATES.has(a.state) ? 1 : 0;
		const bt = TERMINAL_STATES.has(b.state) ? 1 : 0;
		if (at !== bt) return at - bt;
		return at ? (b.endedAt ?? 0) - (a.endedAt ?? 0) : a.startedAt - b.startedAt;
	});
}

export function renderFooter(model: FooterModel, width: number, theme: ThemeLike, opts: RenderOpts): string[] {
	const minions = orderMinions(model.minions);
	if (width < 60) {
		const live = minions.filter((m) => !TERMINAL_STATES.has(m.state)).length;
		const kids = minions.reduce((a, m) => a + m.cost, 0);
		const pct = model.main.ctxPercent != null ? ` · ctx ${model.main.ctxPercent.toFixed(0)}%` : "";
		return [truncateToWidth(`${live}/${minions.length} minions · ${fmtUsd(model.main.cost + kids)}${pct}`, width)];
	}
	const lines = [mainLine(model, width, theme, opts)];
	const minionBudget = model.note ? 1 : 2;
	lines.push(...packMinions(minions, width, width < 80 ? Math.min(minionBudget, minions.length) : minionBudget, theme, opts));
	if (model.note) lines.push(noteLine(model.note, width, theme, opts));
	return lines;
}

// ---------------------------------------------------------------- phase HUD

export type PhaseStatus = "pending" | "active" | "done" | "failed";
export interface HudModel {
	minions: Minion[];
	budgetUsd: number;
	spent: number;
	parkingLot: number;
}

const PHASES = PERSONAS.filter((p) => p.name !== "bodydouble");

export function phaseStatuses(minions: Minion[]): { phase: string; status: PhaseStatus }[] {
	return PHASES.map((p) => {
		const own = minions.filter((m) => personaFor(m.agent)?.name === p.name);
		const status: PhaseStatus = own.some((m) => !TERMINAL_STATES.has(m.state))
			? "active"
			: own.some((m) => m.state === "failed" || m.state === "killed")
				? "failed"
				: own.length
					? "done"
					: "pending";
		return { phase: p.phase, status };
	});
}

export function renderHud(model: HudModel, width: number, theme: ThemeLike, opts: RenderOpts): string[] {
	const crew = model.minions.filter((m) => personaFor(m.agent) && personaFor(m.agent)!.name !== "bodydouble");
	if (!crew.length) return [];
	const chev = opts.calm ? "▸" : ["▸  ", "▸▸ ", "▸▸▸", " ▸▸", "  ▸"][opts.frame % 5]!;
	const pulse = opts.calm || opts.frame % 6 < 3;
	const strip = phaseStatuses(crew)
		.map(({ phase, status }) => {
			if (status === "done") return `${theme.fg("success", phase)} ${theme.fg("success", "✓")}`;
			if (status === "failed") return `${theme.fg("error", phase)} ${theme.fg("error", "✗")}`;
			if (status === "active") return `${theme.fg(pulse ? "accent" : "dim", theme.bold(phase))} ${theme.fg("accent", chev)}`;
			return `${theme.fg("dim", phase)} ${theme.fg("dim", "·")}`;
		})
		.join("   ");
	const round = crew.filter((m) => personaFor(m.agent)?.name === "hyperfocus").length;
	const since = Math.min(...crew.map((m) => m.startedAt));
	const live = crew.some((m) => !TERMINAL_STATES.has(m.state));
	const until = live ? opts.now : Math.max(...crew.map((m) => m.endedAt ?? m.startedAt));
	const right = theme.fg("dim", `round ${Math.max(1, round)}/3  ${fmtDur(until - since)}`);
	const lines = [truncateToWidth(`${strip}   ${right}`, width)];

	const extras: string[] = [];
	if (model.budgetUsd > 0) {
		const left = Math.max(0, 1 - model.spent / model.budgetUsd);
		const c: Color = left <= 0 ? "error" : left < 0.2 ? "warning" : "success";
		extras.push(`spoons ${theme.fg(c, bar(left, 10, "▮", "▯"))} ${theme.fg(c, `${Math.round(left * 100)}%`)} ${theme.fg("dim", `of ${fmtUsd(model.budgetUsd)}`)}`);
	}
	if (model.parkingLot > 0) extras.push(theme.fg("muted", `parking-lot ${model.parkingLot}`));
	const sprinting = crew.find((m) => personaFor(m.agent)?.name === "hyperfocus" && !TERMINAL_STATES.has(m.state));
	if (sprinting) {
		const limit = personaFor("hyperfocus")!.timeoutMs ?? 0;
		const left = limit - (opts.now - sprinting.startedAt);
		const blink = left < 300_000 && !opts.calm && opts.frame % 4 < 2;
		extras.push(theme.fg(left < 300_000 ? (blink ? "error" : "dim") : "muted", `timebox ${opts.ascii ? "" : "⏱ "}${fmtDur(left)} left`));
	}
	if (extras.length) lines.push(truncateToWidth(extras.join("   "), width));
	return lines;
}
