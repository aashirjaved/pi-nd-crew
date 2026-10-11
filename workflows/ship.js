// nd-crew ship workflow for pi-subagents.
// pattern (analyse) -> mapper (plan) -> hyperfocus (build) -> literal (review), up to 3 build/review rounds.
// args: { task: string, worktree?: boolean, rounds?: number }
const task = String(args.task || "").trim();
if (!task) throw new Error("ship: args.task is required");
const maxRounds = Math.max(1, Math.min(5, Number(args.rounds) || 3));
const worktree = args.worktree === true;

const recon = await runs.run("pattern", {
	agent: "pattern",
	task: ["Find everything in this repo relevant to the task below.", "Task: " + task].join("\n"),
});
if (!recon.ok) return { stage: "analyse", ok: false, output: recon.output };

const plan = await runs.run("mapper", {
	agent: "mapper",
	task: [
		"Write the implementation plan for the task below.",
		"Task: " + task,
		"",
		"Evidence from pattern:",
		recon.output,
	].join("\n"),
});
if (!plan.ok) return { stage: "map", ok: false, output: plan.output };

let round = 0;
let verdict = "";
let build = null;
while (round < maxRounds) {
	build = await runs.run("hyperfocus-" + round, {
		agent: "hyperfocus",
		worktree,
		task: round === 0
			? ["Task: " + task, "", "Save this plan to .pi/nd-crew/plan.md, then implement it:", plan.output].join("\n")
			: ["Address these review findings, then re-run the plan's verification:", verdict].join("\n"),
	});
	if (!build.ok) return { stage: "hyperfocus", round, ok: false, output: build.output };
	const review = await runs.run("literal-" + round, {
		agent: "literal",
		task: [
			"Review the changes just made for this task against the plan in .pi/nd-crew/plan.md and the task text. Read every file listed in the implementer report.",
			"Task: " + task,
			"",
			"Implementer report:",
			build.output,
		].join("\n"),
	});
	verdict = review.output || "";
	round++;
	if (/Verdict:\s*APPROVE/i.test(verdict)) break;
}

return {
	ok: /Verdict:\s*APPROVE/i.test(verdict),
	rounds: round,
	verdict: verdict.split("\n").slice(-12).join("\n"),
	implementer: build ? build.output.split("\n").slice(-20).join("\n") : "",
};
