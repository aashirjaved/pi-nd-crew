/** Fleet overlay (alt+a / /fleet): every minion in full detail, with stop and steer for background runs. */
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { personaFor } from "./crew.ts";
import { TERMINAL_STATES, type Minion } from "./fleet.ts";
import { fmtDur, fmtInt, fmtUsd, minionSegment, orderMinions, type RenderOpts, type ThemeLike } from "./render.ts";

export type OverlayAction = { kind: "close" } | { kind: "stop"; minion: Minion } | { kind: "steer"; minion: Minion };

export function minionDetail(m: Minion, theme: ThemeLike, opts: RenderOpts, width: number): string[] {
	const p = personaFor(m.agent);
	const lines = [minionSegment(m, theme, { ...opts }, 2)];
	const who = p ? `${p.role} · ${p.trait}` : "builtin or user agent";
	lines.push(theme.fg("dim", `   ${who}`));
	lines.push(
		theme.fg("muted", `   ${m.source === "async" ? "background" : "foreground"} · ${m.model ?? "default model"}${m.thinking ? ` · thinking ${m.thinking}` : ""}`),
		theme.fg(
			"muted",
			`   ${fmtUsd(m.cost, m.costExact)} · in ${fmtInt(m.input)} · out ${fmtInt(m.output)} · cache r/w ${fmtInt(m.cacheRead)}/${fmtInt(m.cacheWrite)} · ` +
				`${m.toolCount} tools · ${m.turns} turns · ${fmtDur((m.endedAt ?? opts.now) - m.startedAt)}`,
		),
	);
	if (m.currentTool) lines.push(theme.fg("text", `   now: ${m.currentTool} ${m.currentArgs ?? ""}`));
	if (m.lastLine) lines.push(theme.fg("dim", `   last: ${m.lastLine}`));
	if (m.error) lines.push(theme.fg("error", `   error: ${m.error}`));
	if (p?.name === "hyperfocus" && m.editsSincePlanRead > 0)
		lines.push(theme.fg(m.editsSincePlanRead >= 3 ? "warning" : "muted", `   ${m.editsSincePlanRead} edits since last plan read`));
	return lines.map((l) => truncateToWidth(l, width));
}

export class FleetOverlay {
	selected = 0;

	constructor(
		private readonly getMinions: () => Iterable<Minion>,
		private readonly theme: ThemeLike,
		private readonly getOpts: () => RenderOpts,
		private readonly done: (action: OverlayAction) => void,
	) {}

	private list(): Minion[] {
		return orderMinions(this.getMinions());
	}

	invalidate(): void {}

	render(width: number): string[] {
		const t = this.theme;
		const minions = this.list();
		const opts = this.getOpts();
		const inner = Math.max(20, width - 4);
		const out = [t.fg("borderAccent", `╭─ nd-crew fleet ${"─".repeat(Math.max(0, inner - 16))}`)];
		if (!minions.length) out.push(t.fg("dim", "  no minions yet. Ask for a subagent, run /ship <task>, or say orchestrate."));
		this.selected = Math.min(this.selected, Math.max(0, minions.length - 1));
		minions.forEach((m, i) => {
			const mark = i === this.selected ? t.fg("accent", "▶ ") : "  ";
			const detail = minionDetail(m, t, opts, inner - 2);
			out.push(mark + detail[0], ...detail.slice(1).map((l) => `  ${l}`));
		});
		out.push(t.fg("dim", "  ↑/↓ select · s steer · k stop (background runs) · esc close"));
		out.push(t.fg("borderAccent", `╰${"─".repeat(Math.max(0, inner))}`));
		return out.map((l) => truncateToWidth(l, width));
	}

	handleInput(data: string): void {
		const minions = this.list();
		const current = minions[this.selected];
		if (matchesKey(data, "escape") || data === "q") return this.done({ kind: "close" });
		if (matchesKey(data, "up")) this.selected = Math.max(0, this.selected - 1);
		else if (matchesKey(data, "down")) this.selected = Math.min(minions.length - 1, this.selected + 1);
		else if (current && !TERMINAL_STATES.has(current.state) && current.source === "async") {
			if (data === "k") return this.done({ kind: "stop", minion: current });
			if (data === "s") return this.done({ kind: "steer", minion: current });
		}
	}
}
