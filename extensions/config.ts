import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PersonaName } from "./crew.ts";

/**
 * nd-crew config. Read from ~/.pi/agent/nd-crew.json, then <cwd>/.pi/nd-crew.json (project wins).
 *
 * Models are optional on purpose: an unset model follows pi-subagents' own
 * `subagents.defaultModel` / `agentOverrides`, so the package works with any provider.
 */
export interface NdConfig {
	/** Per-persona model, "provider/model-id". */
	models: Partial<Record<PersonaName, string>>;
	/** Per-persona thinking level override. */
	thinking: Partial<Record<PersonaName, string>>;
	/** Spoons budget in USD for one session. 0 disables the gate. */
	budgetUsd: number;
	/** Freeze all animation. Auto-on with NO_COLOR or PI_REDUCED_MOTION=1. */
	calm: boolean;
	/** ASCII badges and sprites for terminals without emoji width support. */
	ascii: boolean;
	/** Phase strip widget above the editor. */
	hud: boolean;
	/** Start sessions with orchestrate mode on. */
	orchestrate: boolean;
	/** Start sessions with the body double watching. */
	bodydouble: boolean;
	/** Parent model while planning in orchestrate mode; switched back after the first edit. */
	parentPlanModel?: string;
	/** Animation frame interval in ms. */
	frameMs: number;
}

export const DEFAULT_CONFIG: NdConfig = {
	models: {},
	thinking: {},
	budgetUsd: 0,
	calm: false,
	ascii: false,
	hud: true,
	orchestrate: false,
	bodydouble: false,
	frameMs: 150,
};

function readJson(path: string): Partial<NdConfig> {
	if (!existsSync(path)) return {};
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		return value && typeof value === "object" ? (value as Partial<NdConfig>) : {};
	} catch (error) {
		console.error(`[nd-crew] ignoring unreadable config ${path}:`, error);
		return {};
	}
}

export function mergeConfig(...layers: Partial<NdConfig>[]): NdConfig {
	const out: NdConfig = { ...DEFAULT_CONFIG, models: {}, thinking: {} };
	for (const layer of layers) {
		const { models, thinking, ...rest } = layer;
		Object.assign(out, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
		Object.assign(out.models, models ?? {});
		Object.assign(out.thinking, thinking ?? {});
	}
	out.frameMs = Math.max(60, Number(out.frameMs) || DEFAULT_CONFIG.frameMs);
	out.budgetUsd = Math.max(0, Number(out.budgetUsd) || 0);
	return out;
}

export function loadConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): NdConfig {
	const agentDir = env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	const cfg = mergeConfig(readJson(join(agentDir, "nd-crew.json")), readJson(join(cwd, ".pi", "nd-crew.json")));
	if (env.NO_COLOR || env.PI_REDUCED_MOTION === "1") cfg.calm = true;
	return cfg;
}
