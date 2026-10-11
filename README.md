# nd-crew

![nd-crew status line](https://unpkg.com/pi-nd-crew/assets/nd-crew.webp)

A neurodivergent crew for [Pi](https://pi.dev). Five subagent personas built on real neurodivergent strengths, and an animated "minions" status line that shows what every worker is doing, what it costs, and how full the context is.

```
ANALYSE ✓   MAP ✓   HYPERFOCUS ▸▸▸   LITERAL ▸▸    round 1/3  0:08
spoons ▮▮▮▮▮▮▮▯▯▯ 67% of $5.0000   parking-lot 2   timebox ⏱ 29:57 left

⠇ main sonnet-5/med  ctx ▰▰▰▱▱▱▱▱ 42.3% 84,556/200.0k  $1.2542 +$0.1187 kids  turn 7  in 61.2k out 9.1k cache 71%  🥄 73%  orch 👁
🔥(•_•)⚙  hyperfocus 0:02 13.8k ≈$0.0373 bash npm test   📏(•o•)📖 literal 0:00 2.2k ≈$0.0058 read src/cli.ts
👁 bodydouble concern: catch narrowed to ENOENT, conflicts with acceptance #2
```

[Watch it animate](https://unpkg.com/pi-nd-crew/assets/nd-crew.mp4), or run `npm run preview` in a checkout.

## The crew

Each persona's system prompt is its working style. Its tools, timeout and read-only role are guardrails for the matching weak spot. The language follows how neurodivergent people describe themselves. Nothing here is a joke about anyone.

| Agent | Role | Strength | Guardrail | Default thinking |
|---|---|---|---|---|
| 🔍 `pattern` | Analyser | Autistic bottom-up systemizing, monotropic focus, literal reading | Read-only, 3 min timeout, 300-word cap | off |
| 🗺 `mapper` | Thinker | Dyslexic big-picture reasoning, holistic plans | Read-only, must start from pattern's evidence | high |
| 🔥 `hyperfocus` | Implementer | ADHD hyperfocus sprints, action bias | Plan saved to a file and re-read before each step, 30 min timebox, parking lot for tangents | medium |
| 📏 `literal` | Reviewer | Autistic rule-keeping and justice sensitivity | Read-only, severity tiers, max 10 findings, explicit verdict | high |
| 👁 `bodydouble` | Advisor | ADHD body doubling | One line, only speaks on drift | medium |

Aliases are namespaced (`nd-implementer`, `nd-reviewer` and so on) so they never collide with pi-subagents' builtin `worker`, `reviewer` or `scout`.

## Install

nd-crew needs [pi-subagents](https://github.com/nicobailon/pi-subagents) for delegation. The status line works without it.

```bash
pi install npm:pi-subagents
```

```bash
pi install npm:pi-nd-crew
```

From a local checkout:

```bash
pi install ./nd-crew
```

Pi allows one footer. Remove other footer packages such as `pi-powerline-footer` or `pi-statusline`, or the last one loaded wins.

pi-subagents also draws its own background-run widget above the editor. To see only the minions, set `"asyncWidget": false` in `~/.pi/agent/extensions/subagent/config.json`. FleetView stays available.

## What you get

### Minions status line

The footer is replaced by up to three lines.

- **Main line.** Spinner while streaming, model and thinking level, context bar with exact tokens, session cost to four decimals, child cost, turn count, input and output tokens, cache hit rate, spoons left, and mode flags.
- **Minion lines.** One sprite per subagent. The face changes with what it is doing: reading, editing, running, thinking, waiting on its supervisor, done, failed or stopped. Each shows elapsed time, tokens, cost and the current tool with its argument. Between tool calls it shows the last tool it ran.
- **Body-double line.** Shown only when the body double has a concern or blocker. It fades after two turns.

Live costs start as estimates from your model registry's prices and are marked with `≈`. Background runs read exact cost from the run's own `status.json`, and foreground runs switch to exact numbers when pi-subagents reports final usage.

On narrow terminals live workers keep their "doing" text and finished ones shrink to small chips. Below 100 columns the exact context token count is dropped so the cost stays visible.

The hyperfocus flame heats up from accent to warning to red as edits pile up without re-reading the plan. That is the drift meter.

Animation runs at about 7 frames per second and only while something is moving. With nothing running, no timers run.

### Phase HUD

A strip above the editor while the crew works: `ANALYSE MAP HYPERFOCUS LITERAL`, with the active phase pulsing. A second line shows the spoons bar, parking-lot count and the hyperfocus timebox.

### Fleet overlay

Press `alt+a` or run `/fleet`. Every minion is listed with model, thinking level, input, output and cache tokens, cost, tool and turn counts, current tool and last output. For background runs, `s` steers and `k` stops.

### Orchestrate

Write the word `orchestrate` in a prompt, or turn it on for the session with `/nd orchestrate on`. The main agent then coordinates: pattern, then mapper, then your approval, then hyperfocus, then literal, up to three rounds. The keyword is ignored inside code spans, code blocks and paths.

Set `parentPlanModel` in the config to switch the main agent to a planning model for orchestrated prompts. It switches back when the prompt ends.

### /ship

```text
/ship add a --version flag that prints package.json's version
```

Runs the whole loop as a pi-subagents workflow in the background. Add `--worktree` to give hyperfocus an isolated git worktree. Its patch then has to be applied from the run's artifacts.

### Body double

`/nd bodydouble on`. After a prompt in which the main agent edited five or more lines, a background `bodydouble` reads the changes and replies with one line. "note: on track" stays silent. A concern or blocker shows in the status line, and a blocker also raises a notification. Its completion wakes the main agent for one short turn so it can react.

### Spoons

`/nd spoons 5` sets a five-dollar session budget. The bar drains as the main session and its children spend. At zero, new `subagent` calls are blocked with a message asking you to raise the budget.

### Low-sensory mode

`/nd calm on` freezes every animation and keeps the numbers updating. It is on automatically when `NO_COLOR` is set or `PI_REDUCED_MOTION=1`. `/nd ascii on` replaces emoji with plain text for terminals that render emoji at the wrong width.

## Commands

| Command | Does |
|---|---|
| `/nd` | Status and help |
| `/nd crew` | Personas, traits, models, tools |
| `/nd orchestrate on\|off` | Coordinate every prompt through the crew |
| `/nd bodydouble on\|off` | Quiet review after edit-heavy prompts |
| `/nd spoons <usd>\|off` | Session budget |
| `/nd calm on\|off` | Stop animation |
| `/nd ascii on\|off` | No emoji |
| `/nd hud on\|off` | Phase strip above the editor |
| `/nd parkinglot` | Show hyperfocus's parked ideas |
| `/nd snapshot [width]` | Print the status line as plain text, useful in RPC mode |
| `/ship [--worktree] <task>` | Full crew workflow |
| `/fleet`, `alt+a` | Fleet overlay |

Toggles are saved in the session, so they survive resume.

## Configuration

Optional. `~/.pi/agent/nd-crew.json`, then `<project>/.pi/nd-crew.json`. The project file wins. See [examples/nd-crew.json](examples/nd-crew.json).

| Key | Default | Meaning |
|---|---|---|
| `models.<persona>` | unset | Model for a persona as `provider/id`. Unset follows pi-subagents' `subagents.defaultModel` and `agentOverrides`. |
| `thinking.<persona>` | persona default | Thinking level override |
| `budgetUsd` | 0 | Spoons budget, 0 is off |
| `orchestrate` | false | Start sessions in orchestrate mode |
| `bodydouble` | false | Start sessions with the body double on |
| `hud` | true | Phase strip |
| `calm` | false | No animation |
| `ascii` | false | No emoji |
| `frameMs` | 150 | Animation frame interval, minimum 60 |
| `parentPlanModel` | unset | Main-agent model while orchestrating |

Pick a different model family for `literal` than for `hyperfocus`, so the reviewer does not share the implementer's blind spots. pi-subagents' `agentOverrides` in `settings.json` still win over this file.

## How it reads live data

Nothing is scraped from text. The extension listens to Pi's own events and pi-subagents' public contracts.

- Main session: assistant message usage from the session branch, and `ctx.getContextUsage()`.
- Foreground children: progress snapshots on `tool_execution_update` for the `subagent` tool, and final usage on `tool_execution_end`.
- Background children and workflows: `subagent:async-started`, `subagent:child-status`, `subagent:async-complete`, `subagent:foreground-complete`, and the in-process RPC `status` method, polled once a second only while a background run is live.
- Exact child totals: the RPC `cost` method after each settled turn.
- Personas are registered with the `pi-subagents:runtime-agent-register:v1` event, so there are no agent files to copy.

Set `NDCREW_DEBUG=/path/to/file.jsonl` to log the raw payloads.

## Development

```bash
npm install
```

```bash
npm run check
```

```bash
pi -e ./extensions/nd-crew.ts
```

Tests run on Node's built-in runner with native type stripping. One test replays a captured real `/ship` run.

## License

MIT
