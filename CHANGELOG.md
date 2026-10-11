# Changelog

## 0.1.1 (2026-10-11)

Fixes found by dogfooding nd-crew on itself.

- Entry file renamed to `extensions/nd-crew.ts`, so Pi lists the extension as `nd-crew.ts` instead of `extensions`.
- Finished minions stay while their batch is still running. The phase strip no longer forgets a finished phase mid-run.
- Exact cost and tokens for background runs and `/ship` children, read from each run's `status.json`. pi-subagents' cost report does not include RPC-spawned runs.
- Child cost no longer drops to $0 when the cost report and the fleet disagree.
- Live workers keep their "doing" text below 100 columns. Finished ones become compact chips.
- Cost stays visible on 60-column terminals.
- Fleet overlay stats wrap onto two lines instead of being cut off.
- Spoons gate extracted into `spoonsBlockReason` with tests. The crew wrote this change itself through `orchestrate`.

## 0.1.0 (2026-10-10)

First release.

- Five persona subagents registered at runtime with pi-subagents: `pattern`, `mapper`, `hyperfocus`, `literal`, `bodydouble`.
- Animated minions status line: main model, thinking level, context bar with exact tokens, exact cost, cache hit rate, turn count, spoons budget, and one sprite per subagent with live tool, tokens, cost and elapsed time.
- Phase HUD above the editor with timebox and parking-lot count.
- `orchestrate` keyword and `/nd orchestrate` mode.
- Body double: one quiet review after a prompt that edited five or more lines.
- `/ship` workflow: analyse, plan, build, review, up to three rounds.
- Fleet overlay on `alt+a` and `/fleet`, with stop and steer for background runs.
- Spoons budget gate on new subagent launches.
- `/nd calm` and `/nd ascii` for low-sensory and emoji-free terminals. `NO_COLOR` or `PI_REDUCED_MOTION=1` start calm.
