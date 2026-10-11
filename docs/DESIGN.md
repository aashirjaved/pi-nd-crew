# Design notes

Why nd-crew is built the way it is.

## Personas

Each persona is modelled on a strength neurodivergent people describe in themselves. Its system prompt is the working style. Its tools, timeout and read-only role are the guardrail for the matching weak spot. Persona language follows the community's own terms: hyperfocus, monotropism, body doubling, spoons.

Ideas borrowed from oh-my-pi: model roles, an advisor that watches every turn, the `orchestrate` keyword, an agent hub. Ideas borrowed from pi-subagents: agents as definitions with per-agent model, thinking and tools, scripted workflows, worktrees and supervisor contact.

## Decisions

- **Runtime registration.** Personas register with pi-subagents through the `pi-subagents:runtime-agent-register:v1` event, so there are no agent files to copy.
- **Namespaced aliases.** Aliases start with `nd-`. Plain `implementer`, `reviewer`, `scout` or `worker` collide with pi-subagents builtins, and one collision makes the whole `subagent` tool refuse to run.
- **Provider-neutral defaults.** The package pins no models. Users set them in `nd-crew.json` or pi-subagents' `agentOverrides`.
- **Plan as text.** The plan is passed to hyperfocus in its task, and hyperfocus saves it to `.pi/nd-crew/plan.md`. pi-subagents' `output` field writes to run artifacts, not the repo.
- **Keys.** The fleet opens on `alt+a`. Bare letters on an empty editor would eat the first character of a message.
- **Parent plan model.** `parentPlanModel` switches back when the prompt ends, because in orchestrate mode the main agent does not edit.
- **Body double wake.** Its completion wakes the main agent for one short turn. pi-subagents' RPC spawn has no quiet completion option.
- **Cost sources.** Foreground children report usage on tool end. Background runs and `/ship` children are read from each run's `status.json`, because the RPC cost report does not include RPC-spawned runs. Child cost is the larger of the cost report and the fleet sum.
- **Footer budget.** At most three lines. Live workers always show what they are doing. Finished workers shrink to chips before anything is hidden.
- **Animation.** Timers run only while something moves. `/nd calm` freezes frames, and it is on automatically with `NO_COLOR` or `PI_REDUCED_MOTION=1`.

## Not built

- Custom tool renderers with success flashes.
- A separate `/role` command. Per-persona models in `nd-crew.json` cover it.
- Cross-session cost ledger.
