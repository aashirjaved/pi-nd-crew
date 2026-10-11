/**
 * Renders the pi.dev gallery assets from the real renderer:
 *   node scripts/gallery.ts            -> assets/nd-crew.webp (poster) and assets/nd-crew.mp4
 * Needs Google Chrome, ffmpeg and cwebp on PATH (macOS paths assumed for Chrome).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Minion, MinionState } from "../extensions/fleet.ts";
import { renderFooter, renderHud, type Color, type FooterModel, type ThemeLike } from "../extensions/render.ts";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const COLS = 112;
const FPS = 8;
const SECONDS = 12;
const W = 1600;
const H = 900;

const PALETTE: Record<Color, string> = {
	accent: "#7dd3fc",
	success: "#86efac",
	warning: "#fcd34d",
	error: "#fca5a5",
	muted: "#cbd5e1",
	dim: "#64748b",
	text: "#f1f5f9",
	borderAccent: "#c4b5fd",
};
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(";");
// Truecolor ANSI so pi-tui's width helpers lay out exactly as in a terminal; converted to HTML below.
const theme: ThemeLike = {
	fg: (c, t) => `\x1b[38;2;${rgb(PALETTE[c])}m${t}\x1b[39m`,
	bold: (t) => `\x1b[1m${t}\x1b[22m`,
};

/** Minimal ANSI SGR to HTML: truecolor foreground, default foreground, bold, reset. */
export function ansiToHtml(line: string): string {
	let color: string | undefined;
	let bold = false;
	let html = "";
	for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
		const m = /^\x1b\[([0-9;]*)m$/.exec(part);
		if (!m) {
			if (!part) continue;
			const style = [color ? `color:rgb(${color.replace(/;/g, ",")})` : "", bold ? "font-weight:700" : ""].filter(Boolean).join(";");
			html += style ? `<span style="${style}">${esc(part)}</span>` : esc(part);
			continue;
		}
		const codes = m[1] ? m[1].split(";") : ["0"];
		for (let i = 0; i < codes.length; i++) {
			const c = codes[i];
			if (c === "0") (color = undefined), (bold = false);
			else if (c === "1") bold = true;
			else if (c === "22") bold = false;
			else if (c === "39") color = undefined;
			else if (c === "38" && codes[i + 1] === "2") (color = codes.slice(i + 2, i + 5).join(";")), (i += 4);
		}
	}
	return html;
}

type Step = [MinionState, string, string];
const T0 = 1_000_000;
const crew: { agent: string; start: number; end: number; steps: Step[]; summary: string }[] = [
	{ agent: "pattern", start: 0, end: 3, steps: [["reading", "grep", "--version src/"], ["reading", "read", "src/cli.ts"]], summary: "4 call sites, 1 inconsistency" },
	{ agent: "mapper", start: 3, end: 5.5, steps: [["thinking", "", ""], ["reading", "read", "package.json"]], summary: "Plan: 3 steps, verify with npm test" },
	{ agent: "hyperfocus", start: 5.5, end: 10, steps: [["editing", "edit", "src/cli.ts:88"], ["running", "bash", "npm test"], ["editing", "write", "test/cli.test.ts"]], summary: "3 files, tests pass" },
	{ agent: "literal", start: 8, end: 11.5, steps: [["reading", "read", "src/cli.ts"], ["reading", "grep", "process.exit"]], summary: "Verdict: APPROVE" },
];

function minionsAt(sec: number): Minion[] {
	return crew
		.filter((c) => sec >= c.start)
		.map((c, i) => {
			const live = sec < c.end;
			const step = c.steps[Math.floor((sec - c.start) * 1.2) % c.steps.length]!;
			const tokens = Math.round((Math.min(sec, c.end) - c.start) * 5300);
			return {
				key: String(i),
				agent: c.agent,
				source: "fg",
				state: live ? step[0] : "done",
				startedAt: T0 + c.start * 1000,
				endedAt: live ? undefined : T0 + c.end * 1000,
				currentTool: live && step[1] ? step[1] : undefined,
				currentArgs: live ? step[2] : undefined,
				lastTool: "read src/cli.ts",
				toolCount: Math.round((sec - c.start) * 2),
				turns: 2,
				input: tokens,
				output: Math.round(tokens / 8),
				cacheRead: 0,
				cacheWrite: 0,
				cost: tokens * 3.2e-6,
				costExact: !live,
				editsSincePlanRead: c.agent === "hyperfocus" ? Math.min(7, Math.floor((sec - c.start) * 1.5)) : 0,
				lastLine: live ? undefined : c.summary,
			} satisfies Minion;
		});
}

const transcript = [
	`<span style="color:${PALETTE.accent}">❯</span> <b>orchestrate</b> add a --version flag that prints package.json's version`,
	"",
	`<span style="color:${PALETTE.dim}">  Coordinating the nd-crew: pattern → mapper → hyperfocus → literal.</span>`,
	`<span style="color:${PALETTE.dim}">  ▸ subagent pattern  "Find every place the CLI parses flags"</span>`,
	`<span style="color:${PALETTE.dim}">  ▸ subagent mapper   "Plan the --version flag from pattern's evidence"</span>`,
	`<span style="color:${PALETTE.dim}">  ▸ subagent hyperfocus  "Implement the plan; save it to .pi/nd-crew/plan.md"</span>`,
	`<span style="color:${PALETTE.dim}">  ▸ subagent literal  "Review the diff against the plan, literally"</span>`,
	"",
	`<span style="color:${PALETTE.success}">  ✓ pattern</span>  <span style="color:${PALETTE.muted}">src/cli.ts:12 parseArgs · src/cli.ts:88 dispatch · 1 inconsistency: -v vs --verbose</span>`,
	`<span style="color:${PALETTE.success}">  ✓ mapper</span>   <span style="color:${PALETTE.muted}">1. read version from package.json  2. add --version branch  3. test</span>`,
];

function frameHtml(frame: number): string {
	const sec = frame / FPS;
	const minions = minionsAt(sec);
	const now = T0 + sec * 1000;
	const kids = minions.reduce((a, m) => a + m.cost, 0);
	const model: FooterModel = {
		main: {
			model: "anthropic/claude-sonnet-5",
			thinking: "medium",
			streaming: true,
			ctxTokens: 82_410 + frame * 91,
			ctxWindow: 200_000,
			ctxPercent: (82_410 + frame * 91) / 2000,
			cost: 1.2310 + frame * 0.0007,
			input: 61_200 + frame * 140,
			output: 9_100 + frame * 12,
			cacheRead: 0,
			cacheHit: 0.71,
			turn: 7,
			kidsCost: kids,
			kidsExact: false,
		},
		minions,
		budgetUsd: 5,
		note: sec > 9 ? { severity: "concern", text: "catch narrowed to ENOENT, conflicts with acceptance #2" } : undefined,
		orchestrate: true,
		bodydouble: true,
	};
	const opts = { frame, calm: false, ascii: false, now };
	const lines = [...renderHud({ minions, budgetUsd: 5, spent: model.main.cost + kids, parkingLot: 1 }, COLS, theme, opts), "", ...renderFooter(model, COLS, theme, opts)].map(ansiToHtml);
	const rule = `<span style="color:#334155">${"─".repeat(COLS)}</span>`;
	return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:${W}px;height:${H}px;background:radial-gradient(1200px 700px at 20% 0%,#312e81 0%,#0b1020 55%,#05070d 100%);font-family:Menlo,"SF Mono",monospace}
.win{position:absolute;left:56px;top:70px;width:${W - 112}px;height:${H - 140}px;background:#0b1120;border:1px solid #1e293b;border-radius:14px;box-shadow:0 30px 80px #000a;overflow:hidden}
.bar{height:38px;background:#111827;display:flex;align-items:center;gap:8px;padding:0 16px;color:#94a3b8;font-size:13px}
.dot{width:12px;height:12px;border-radius:50%}
pre{margin:0;padding:18px 22px;color:#e2e8f0;font-size:17.5px;line-height:1.5;white-space:pre}
.title{position:absolute;left:58px;top:22px;color:#e0e7ff;font:600 26px -apple-system,Helvetica,sans-serif;letter-spacing:.2px}
.title span{color:#a5b4fc;font-weight:400;font-size:18px;margin-left:12px}
.bottom{position:absolute;left:0;right:0;bottom:0}
</style>
<div class="title">nd-crew<span>a neurodivergent crew for Pi · live minions status line</span></div>
<div class="win"><div class="bar"><div class="dot" style="background:#f87171"></div><div class="dot" style="background:#fbbf24"></div><div class="dot" style="background:#34d399"></div><span style="margin-left:10px">pi — ~/code/cli</span></div>
<pre>${transcript.join("\n")}</pre>
<div class="bottom"><pre>${lines.join("\n")}\n${rule}\n<span style="color:${PALETTE.accent}">›</span> <span style="color:#475569">type a message, or alt+a for the fleet</span></pre></div></div>`;
}

const out = join(import.meta.dirname, "..", "assets");
mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "nd-gallery-"));
const frames = FPS * SECONDS;
for (let f = 0; f < frames; f++) {
	const html = join(tmp, `f${String(f).padStart(3, "0")}.html`);
	writeFileSync(html, frameHtml(f));
	execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${W},${H}`, `--screenshot=${html.replace(/\.html$/, ".png")}`, `file://${html}`], { stdio: "ignore" });
	process.stdout.write(`\rframe ${f + 1}/${frames}`);
}
process.stdout.write("\n");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(tmp, "f%03d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24", "-movflags", "+faststart", join(out, "nd-crew.mp4")]);
execFileSync("cwebp", ["-quiet", "-q", "82", join(tmp, `f${String(Math.floor(FPS * 8.6)).padStart(3, "0")}.png`), "-o", join(out, "nd-crew.webp")]);
rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${join(out, "nd-crew.mp4")} and ${join(out, "nd-crew.webp")}`);
