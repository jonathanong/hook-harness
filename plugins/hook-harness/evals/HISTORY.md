# History

Newest first.

## 2026-11-28: rerun after review fixes

- Commit `924b96f`. Claude Code 2.1.332, default agent model; judge haiku. 3 attempts per case, one arm. Cost: agent $2.01, judges $0.04.
- Scores: every case passed 3 of 3. The skill loaded 3 of 3 on every case except `lookalike-pr-ci` (0 of 3).
- Changes since the previous entry, all to the skill's text after review:
  - It identifies a run by `runId`, not `headSha`.
  - The run lookup passes `--repo`.
  - It notes that `deployment:<env>@<branch>` needs a deployer that sends a branch ref.
  - AGENTS.md adds priority targets and the control-arm rule.
- What it showed: the review edits did not move any case. Earlier entries name commits that the rebase onto `d8c85c9` rewrote, so they are not in the branch history.

## 2026-11-28: the pr-shepherd-missing rule, fix against control

- Commit: `cf95279` plus the new case. Same models. 5 attempts per arm. The control arm is a copy of the plugin with the rule's sentence removed from the skill. Cost: agent $1.10, judges $0.01.
- Scores on `lookalike-pr-ci-named` (new): with the rule, skill loaded 5 of 5 and answer passed 5 of 5; control, loaded 5 of 5, passed 1 of 5.
- Changes: added `lookalike-pr-ci-named`, which names hook-harness in the prompt so the skill loads, because `lookalike-pr-ci` never loaded it.
- What it showed: without the rule, the agent noted that pr-shepherd was missing and fell back to a hook-harness wait on the PR's checks in 4 of 5 attempts. With the rule it did not, in any attempt.

## 2026-11-28: first measured run, single arm

- Commit: the commit that added this suite (parent `93816c9`). Claude Code 2.1.332, default agent model; judge haiku. 3 attempts per case, `--ablation none`. Cost: agent $1.62, judges $0.02.
- Scores: skill loaded 3 of 3 and answer passed 3 of 3 on `workflow-publish-main`, `deploy-vercel-production`, `release-upstream-tag` and `external-ci-circleci-status`. `lookalike-pr-ci`: answer passed 3 of 3, skill loaded 0 of 3.
- Changes since the previous entry:
  - The suite dropped the baseline arm.
  - The skill now says not to wait on a PR's checks through hook-harness when pr-shepherd is not installed.
- What it showed: with the plugin installed, the agent picks the new presets and scopes them correctly. The lookalike case never loaded the skill, so the new rule is untested.

## 2026-11-28: with/without run, baseline dropped

- Same models. 3 attempts per arm, `--ablation with-without`. Cost: agent $2.92, judges $0.05.
- Scores:
  - Trigger cases: with the plugin, answer 3 of 3 and loaded 3 of 3 on all four; without it, 0 of 3.
  - `lookalike-pr-ci`: 2 of 3 with the plugin, 3 of 3 without.
- What it showed:
  - The baseline fails by construction: its judges require hook-harness, and an agent without the plugin polls `gh` instead, which does the job. So the +1.0 delta is not a result, and later runs use one arm.
  - The lookalike failure was real. pr-shepherd is not installed in the eval environment, so the agent loaded the skill and fell back to a hook-harness `check_suite`/`workflow_run` wait for PR #12. That led to the skill fix above.

## 2026-11-28: pilot

- Five cases, 1 attempt per arm, with-without. Cost $0.94. It checked that the graders run and discriminate. No scores quoted.
