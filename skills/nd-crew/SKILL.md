---
name: nd-crew
description: How to delegate to the nd-crew personas (pattern, mapper, hyperfocus, literal, bodydouble) with the subagent tool. Use when the user says orchestrate, asks for the crew, wants recon, a plan, an implementation sprint, or a literal spec review.
---

# nd-crew

Five subagent personas, each built on a neurodivergent strength. Their tools and limits cover the matching weak spot. Call them with the `subagent` tool by name.

| Agent | Role | Use it for | Do not use it for |
|---|---|---|---|
| `pattern` | Analyser | Fast read-only recon: every relevant file, symbol, call site with file:line, plus inconsistencies | Opinions, plans, edits |
| `mapper` | Thinker | A numbered plan from pattern's evidence: goal, steps, risks, verification commands | Re-scanning the whole repo, editing |
| `hyperfocus` | Implementer | Executing an approved plan one step at a time, running verification | Open-ended exploration, tasks without a plan |
| `literal` | Reviewer | Checking a diff against the plan and the user's exact words; verdict APPROVE or REQUEST_CHANGES | Writing fixes |
| `bodydouble` | Advisor | One-line drift check after edits. Usually launched automatically by `/nd bodydouble on` | Anything long |

## Handoffs

- Give `mapper` the evidence from `pattern` in its task. It returns the plan as its answer.
- Give `hyperfocus` the full plan text. It saves it to `.pi/nd-crew/plan.md` and re-reads it before each step.
- Give `literal` the task text and hyperfocus's report, including the files changed.
- On `Verdict: REQUEST_CHANGES`, send literal's findings back to `hyperfocus`. Stop after three rounds and report.
- Ideas outside the current step land in `.pi/nd-crew/parking-lot.md`. Mention them in the final summary.

## Shortcuts the user has

- `/ship <task>` runs the whole loop as a pi-subagents workflow.
- Saying `orchestrate` in a prompt, or `/nd orchestrate on`, makes the main agent coordinate instead of editing.
- `/nd spoons <usd>` sets a budget. When it is spent, new subagent launches are blocked; ask the user to raise it.
