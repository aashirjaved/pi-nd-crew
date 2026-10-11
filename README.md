<div align="center">

# nd-crew

**Five specialist subagents for [Pi](https://pi.dev), and a status line that shows what every one of them is doing.**

<a href="https://cdn.jsdelivr.net/gh/aashirjaved/pi-nd-crew@main/assets/nd-crew.mp4"><img src="https://cdn.jsdelivr.net/gh/aashirjaved/pi-nd-crew@main/assets/hero.webp" alt="Pi with nd-crew: the crew analyses, plans, builds and reviews while the footer shows each worker's sprite, current tool, tokens and cost" width="900"></a>

```bash
pi install npm:pi-subagents && pi install npm:pi-nd-crew
```

Then type `orchestrate` in any prompt, or run `/ship <task>`.

</div>

## Why

Delegating to subagents is powerful and hard to watch. You cannot see who is working, what each one is touching, how much it costs, or whether the implementer has drifted from the plan.

nd-crew fixes both halves:

- **A crew that works well together.** Five personas built on real neurodivergent strengths. Each one's tools and limits cover its matching weak spot, and each hands its work to the next in a fixed shape.
- **A footer you can read at a glance.** The main session's model, context and exact cost on one line. One animated sprite per worker underneath, saying what it is doing right now and what it has spent.

<img src="https://cdn.jsdelivr.net/gh/aashirjaved/pi-nd-crew@main/assets/crew.svg" alt="The five personas: pattern the analyser, mapper the thinker, hyperfocus the implementer, literal the reviewer, bodydouble the advisor, each with its strength and guardrail" width="900">

The personas use the words neurodivergent people use about themselves: hyperfocus, monotropism, body doubling, spoons. They describe strengths. Nothing here is a joke about anyone.

<img src="https://cdn.jsdelivr.net/gh/aashirjaved/pi-nd-crew@main/assets/pipeline.svg" alt="pattern analyses, mapper plans, hyperfocus builds, literal reviews; requested changes loop back to hyperfocus up to three times; bodydouble watches the main agent's edits" width="900">

## What the status line tells you

```
ANALYSE ✓   MAP ✓   HYPERFOCUS ▸▸▸   LITERAL ▸▸    round 1/3  0:08
spoons ▮▮▮▮▮▮▮▯▯▯ 71% of $5.0000   parking-lot 1   timebox ⏱ 29:57 left

⠼ main sonnet-5/med  ctx ▰▰▰▱▱▱▱▱ 44.3% 88,598/200.0k  $1.2786 +$0.1526 kids  turn 7  in 70.7k out 9.9k cache 71%
🔥(⌐■_■)🔨 hyperfocus 0:03 17.9k $0.0509 edit src/cli.ts:88   📏(•_•)📖 literal 0:00 3.0k $0.0085 read src/cli.ts
🗺(^‿^)✓ mapper 0:02   🔍(^‿^)✓ pattern 0:03
```

| You see | It means |
|---|---|
| Phase strip | Where the task is: analyse, plan, build, review, and which review round |
| Spoons bar | How much of your session budget is left. At zero, new subagents are blocked until you raise it |
| Timebox | Time left in hyperfocus's sprint. The last five minutes blink |
| Main line | Model, thinking level, context fill with exact tokens, session cost to four decimals, child cost, cache hit rate |
| Sprite faces | What each worker is doing: reading 📖, editing 🔨, running ⚙, thinking ···, waiting for an answer zz, done ✓, failed ✗ |
| The flame | Hyperfocus's drift meter. It heats up to amber, then red, as edits pile up without re-reading the plan |
| `≈$` | A live estimate. It becomes exact when the run reports final usage |

Press `alt+a` for the fleet view: every worker's model, tokens, cache, cost, tool count and last output, with steer and stop for background runs.

## Measured, not promised

Numbers from running nd-crew on its own repository.

| | |
|---|---|
| Idle CPU added | None measurable: 0.1% with and without nd-crew over a 15 s sample |
| Timers while nothing runs | Zero. Animation starts with the first worker and stops with the last |
| Footer height | Never more than 3 lines, from 60 columns up |
| Runtime dependencies | Zero |
| Code | About 80 kB of TypeScript, loaded as source by Pi |
| Tests | 34, including a replay of a real `/ship` run's event stream |
| Self-hosting | The crew wrote one of its own features: `orchestrate` took a refactor plus tests from prompt to approved diff in about two minutes |

## With and without nd-crew

nd-crew runs on top of [pi-subagents](https://github.com/nicobailon/pi-subagents). It does not replace it.

| | pi-subagents alone | with nd-crew |
|---|---|---|
| Delegation engine, workflows, worktrees | ✓ | ✓ the same engine |
| Specialist agents | General builtins: scout, worker, reviewer, oracle | Five personas with matched guardrails and fixed handoffs |
| Start a full crew run | Prompt templates such as `/review-loop` | Say `orchestrate`, or `/ship <task>` for analyse, plan, build and review up to three rounds |
| Where you watch workers | Its own widget and FleetView | One footer with the main session and every worker together |
| Drift meter, phase strip, timebox, parking lot | | ✓ |
| Advisor after edits | Ask the oracle | The body double reviews automatically after an edit-heavy prompt and speaks only on drift |
| Session-wide spend cap | | ✓ spoons budget blocks new subagents when spent |
| Low-sensory mode | | `/nd calm`, `NO_COLOR`, `PI_REDUCED_MOTION=1` |

[oh-my-pi](https://github.com/can1357/oh-my-pi) builds roles, an advisor and an agent hub into a fork of Pi. nd-crew brings that way of working to stock Pi as one package.

## Install

```bash
pi install npm:pi-subagents
```

```bash
pi install npm:pi-nd-crew
```

The status line works without pi-subagents. Delegation, `/ship` and the body double need it.

Pi allows one footer. Remove other footer packages such as `pi-powerline-footer` or `pi-statusline`. pi-subagents also draws its own background widget. To see only the minions, set `"asyncWidget": false` in `~/.pi/agent/extensions/subagent/config.json`.

## Use it

| Command | Does |
|---|---|
| `orchestrate` in a prompt | The main agent coordinates the crew instead of editing |
| `/ship [--worktree] <task>` | Full crew workflow in the background |
| `/fleet` or `alt+a` | Fleet view with steer and stop |
| `/nd` | Status and help |
| `/nd crew` | Personas, traits, models, tools |
| `/nd orchestrate on\|off` | Coordinate every prompt through the crew |
| `/nd bodydouble on\|off` | Quiet review after edit-heavy prompts |
| `/nd spoons <usd>\|off` | Session budget |
| `/nd calm on\|off` | Stop all animation |
| `/nd ascii on\|off` | No emoji |
| `/nd hud on\|off` | Phase strip above the editor |
| `/nd parkinglot` | Ideas hyperfocus set aside |
| `/nd snapshot [width]` | Status line as plain text |

Toggles are saved in the session and survive resume.

<details>
<summary><b>Configuration</b></summary>

Optional. `~/.pi/agent/nd-crew.json`, then `<project>/.pi/nd-crew.json`. The project file wins. See [examples/nd-crew.json](examples/nd-crew.json).

| Key | Default | Meaning |
|---|---|---|
| `models.<persona>` | unset | `provider/id`. Unset follows pi-subagents' `subagents.defaultModel` and `agentOverrides` |
| `thinking.<persona>` | persona default | Thinking level override |
| `budgetUsd` | 0 | Spoons budget, 0 is off |
| `orchestrate` | false | Start sessions in orchestrate mode |
| `bodydouble` | false | Start sessions with the body double on |
| `hud` | true | Phase strip |
| `calm` | false | No animation |
| `ascii` | false | No emoji |
| `frameMs` | 150 | Animation frame interval, minimum 60 |
| `parentPlanModel` | unset | Main-agent model while orchestrating |

Give `literal` a different model family than `hyperfocus`, so the reviewer does not share the implementer's blind spots.

</details>

<details>
<summary><b>How it reads live data</b></summary>

Nothing is scraped from text. nd-crew listens to Pi's events and pi-subagents' public contracts.

- **Main session.** Assistant message usage from the session branch, and `ctx.getContextUsage()`.
- **Foreground workers.** Progress snapshots on `tool_execution_update` for the `subagent` tool, and final usage on `tool_execution_end`.
- **Background workers and workflows.** `subagent:async-started`, `subagent:child-status`, `subagent:async-complete` and `subagent:foreground-complete`. Also the in-process RPC `status`, polled once a second only while a background run is live. Exact cost comes from each run's `status.json`.
- **Personas.** Registered with the `pi-subagents:runtime-agent-register:v1` event, so there are no agent files to copy. Aliases start with `nd-` so they never collide with pi-subagents builtins.

Set `NDCREW_DEBUG=/path/to/file.jsonl` to log the raw payloads. Design decisions are in [docs/DESIGN.md](docs/DESIGN.md).

</details>

<details>
<summary><b>Development</b></summary>

```bash
npm install
```

```bash
npm run check
```

```bash
pi -e ./extensions/nd-crew.ts
```

`npm run preview` animates the status line in your terminal without Pi. `npm run gallery` re-renders the preview media from the real renderer. It needs Chrome, ffmpeg, cwebp and img2webp.

</details>

## License

MIT
