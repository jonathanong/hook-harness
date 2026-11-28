# Eval rules

- Run the suite with `claude plugin eval plugins/hook-harness --runs 3 --ablation none --no-publish --trust-plugin` from the repo root. Use `--case '<glob>'` for one case and `--tag <tag>` for a group (`trigger`, `no-trigger`, `deployment`, `release`, `external-ci`, `workflow`, `pr`). Pilot a new case with `--runs 1` first.
- Set a case's priority by what its failure costs a user: `high` when the agent would poll, miss the event or act on the wrong run, deploy or release; `medium` when the cost is extra work or a wrong suggestion that the user would catch.
- Give every case a priority tag and hold it to that target: `high` passes 70% (3 of 3 at three attempts), `medium` 60% (2 of 3). Hold skill loading on trigger cases to 80%, judged over six attempts or more. Report counts ("3 of 3"), never bare rates.
- Keep one arm. Without the plugin hook-harness does not exist, so a baseline arm fails by construction and its delta means nothing.
- Each case is `<name>/prompt.md` plus `graders/answer.md` (an LLM judge). Trigger cases also get `graders/skill-fired.md` (`tool_used: Skill`, matching `hook-harness`). Tag every case with its group and its priority (`high` or `medium`).
- Prompts describe a real situation and end by asking what the agent will run, and say not to run anything that changes a repository or calls GitHub. Allow only `Read, Glob, Grep, Skill`. There is no network and no MCP mock. No case may dispatch a workflow, merge, deploy or call `gh` for real.
- To test a skill rule, use a case whose prompt makes the skill load, and compare it with a control in the same session: a copy of the plugin with only that rule removed.
- A judge names the exact preset or an equivalent filter, the identity check (commit, tag, run), and the forbidden fallbacks (polling loops, sleeps). Never loosen a judge to make a run pass. Read the failing attempt and fix the case, the judge or the skill.
- Any change to a case, a grader, or the skill's text updates `README.md` and `HISTORY.md` in the same commit. Rebuild the `README.md` table from a single run. When there was no run, add a `HISTORY.md` entry that says so and mark the affected rows not re-measured.
- `results/` is git-ignored raw output. Do not commit it.
