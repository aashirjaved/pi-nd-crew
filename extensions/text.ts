/** Small pure text helpers. */
import type { Note } from "./render.ts";

/** Remove fenced blocks, inline code spans and XML/HTML sections so keywords there don't trigger. */
function prose(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/~~~[\s\S]*?~~~/g, " ")
		.replace(/`[^`\n]*`/g, " ")
		.replace(/<([a-zA-Z][\w-]*)[^>]*>[\s\S]*?<\/\1>/g, " ");
}

/** True when `orchestrate` appears as a standalone lowercase word in prose (not a path or identifier). */
export function hasOrchestrateKeyword(prompt: string): boolean {
	return /(^|[\s(,;:!?"'])orchestrate(?=$|[\s),;:!?."'])/.test(prose(prompt));
}

/** Parse the body double's one-line verdict. "note: on track" and empty output mean nothing to show. */
export function parseBodydouble(output: string | undefined): Note | undefined {
	if (!output) return undefined;
	for (const raw of output.split("\n")) {
		const line = raw.replace(/^[\s*>`-]+/, "").trim();
		const m = /^(note|concern|blocker)\s*[:\-–]\s*(.+)$/i.exec(line);
		if (!m) continue;
		const severity = m[1]!.toLowerCase() as Note["severity"];
		const text = m[2]!.trim();
		if (severity === "note" && /^on track\.?$/i.test(text)) return undefined;
		return { severity, text };
	}
	return undefined;
}

/** Reason to block delegation when spoons (USD budget) are spent; undefined when allowed or no budget. */
export function spoonsBlockReason(spent: number, budgetUsd: number): string | undefined {
	if (budgetUsd <= 0 || spent < budgetUsd) return undefined;
	return `nd-crew spoons are spent: $${spent.toFixed(4)} of $${budgetUsd.toFixed(2)} budget. Ask the user to raise it with /nd spoons <usd> before delegating more.`;
}

export const ORCHESTRATE_PROMPT = `
## nd-crew orchestration (active)

Delegate this task to the nd-crew personas with the \`subagent\` tool. You are the coordinator: you do not edit code yourself in this mode.

1. Clarify. If the request is ambiguous in a way that changes the work, ask the user first.
2. ANALYSE: run \`pattern\` (in parallel if there are independent questions). It is read-only and fast.
3. MAP: run \`mapper\` with pattern's evidence in the task. It returns the plan.
4. Show the plan to the user in a few lines and wait for approval unless they already said to proceed.
5. HYPERFOCUS: run \`hyperfocus\` with the full plan text in its task. It saves the plan to .pi/nd-crew/plan.md and implements it step by step.
6. LITERAL: run \`literal\` on the resulting diff. On "Verdict: REQUEST_CHANGES" send findings back to hyperfocus. Stop after 3 rounds.
7. Summarize: files changed, verification run, literal's verdict, parking-lot items, anything skipped.

Pass each child only what it needs. Never paste the whole conversation into a child task.
`.trim();
