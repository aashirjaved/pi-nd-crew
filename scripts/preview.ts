/**
 * Animated preview of the nd-crew status line and phase HUD, no Pi needed.
 *   node scripts/preview.ts [seconds] [width] [--calm] [--ascii]
 */
import { PERSONAS } from "../extensions/crew.ts";
import type { Minion, MinionState } from "../extensions/fleet.ts";
import { renderFooter, renderHud, type Color, type FooterModel, type ThemeLike } from "../extensions/render.ts";

const args = process.argv.slice(2);
const seconds = Number(args.find((a) => /^\d+$/.test(a)) ?? 12);
const width = Number(args.filter((a) => /^\d+$/.test(a))[1] ?? process.stdout.columns ?? 140);
const calm = args.includes("--calm");
const ascii = args.includes("--ascii");

const ANSI: Record<Color, number> = { accent: 36, success: 32, warning: 33, error: 31, muted: 37, dim: 90, text: 97, borderAccent: 35 };
const theme: ThemeLike = {
	fg: (c, t) => `\x1b[${ANSI[c]}m${t}\x1b[39m`,
	bold: (t) => `\x1b[1m${t}\x1b[22m`,
};

const t0 = Date.now();
const script: { agent: string; start: number; end: number; tools: [MinionState, string, string][] }[] = [
	{ agent: "pattern", start: 0, end: 3.5, tools: [["reading", "grep", "--version src/"], ["reading", "read", "src/cli.ts"]] },
	{ agent: "mapper", start: 3.5, end: 6, tools: [["thinking", "", ""], ["reading", "read", "package.json"]] },
	{ agent: "hyperfocus", start: 6, end: 10.5, tools: [["editing", "edit", "src/cli.ts:88"], ["running", "bash", "npm test"], ["editing", "write", "test/cli.test.ts"]] },
	{ agent: "literal", start: 8.5, end: 11.5, tools: [["reading", "read", "src/cli.ts"], ["reading", "grep", "process.exit"]] },
];

function minionsAt(sec: number): Minion[] {
	return script
		.filter((s) => sec >= s.start)
		.map((s, i) => {
			const live = sec < s.end;
			const step = s.tools[Math.floor((sec - s.start) * 1.5) % s.tools.length]!;
			const tokens = Math.round((Math.min(sec, s.end) - s.start) * 4200);
			return {
				key: String(i),
				agent: s.agent,
				source: "fg",
				state: live ? step[0] : "done",
				startedAt: t0 + s.start * 1000,
				endedAt: live ? undefined : t0 + s.end * 1000,
				currentTool: live && step[1] ? step[1] : undefined,
				currentArgs: live ? step[2] : undefined,
				toolCount: Math.round((sec - s.start) * 2),
				turns: 1,
				input: tokens,
				output: Math.round(tokens / 9),
				cacheRead: 0,
				cacheWrite: 0,
				cost: tokens * 3e-6,
				costExact: !live,
				editsSincePlanRead: s.agent === "hyperfocus" ? Math.floor(sec - s.start) : 0,
				lastLine: live ? undefined : PERSONAS.find((p) => p.name === s.agent)!.role + " finished",
			} satisfies Minion;
		});
}

let frame = 0;
let drawn = 0;
const timer = setInterval(() => {
	const sec = ((Date.now() - t0) / 1000) % 13;
	const minions = minionsAt(sec);
	const model: FooterModel = {
		main: { model: "anthropic/claude-sonnet-5", thinking: "medium", streaming: true, ctxTokens: 82_410 + frame * 37, ctxWindow: 200_000, ctxPercent: (82_410 + frame * 37) / 2000, cost: 1.231 + frame * 0.0004, input: 61_200, output: 9_100, cacheRead: 0, cacheHit: 0.71, turn: 7, kidsExact: false },
		minions,
		budgetUsd: 5,
		note: sec > 9 ? { severity: "concern", text: "catch narrowed to ENOENT, conflicts with acceptance #2" } : undefined,
		orchestrate: true,
		bodydouble: true,
	};
	const opts = { frame: frame++, calm, ascii, now: Date.now() };
	const lines = [...renderHud({ minions, budgetUsd: 5, spent: model.main.cost + minions.reduce((a, m) => a + m.cost, 0), parkingLot: 2 }, width, theme, opts), "", ...renderFooter(model, width, theme, opts)];
	if (drawn) process.stdout.write(`\x1b[${drawn}A`);
	process.stdout.write(lines.map((l) => `\x1b[2K${l}`).join("\n") + "\n");
	for (let i = lines.length; i < drawn; i++) process.stdout.write("\x1b[2K\n");
	drawn = Math.max(drawn, lines.length);
}, 150);

setTimeout(() => {
	clearInterval(timer);
	process.stdout.write("\n");
}, seconds * 1000);
