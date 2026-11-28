# hook-harness evals

These are `claude plugin eval` cases for the `hook-harness` skill. Each case asks an agent with the plugin installed to wait for a GitHub event outside a pull request: a workflow run, a deployment, a release, or an external CI commit status. Every case answers one question: does the agent load the skill and plan the right hook-harness wait? That means the right preset, scoped to the right commit or tag, from the right start point, with no polling. The lookalike case checks the reverse: a PR's CI belongs to pr-shepherd, so the agent should not wait on it through hook-harness.

## Current results

| Run                 | Value                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| Date                | 2026-11-28                                                                          |
| Commit              | the commit that added this suite (parent `93816c9`), with the skill fix it contains |
| Agent model         | Claude Code 2.1.332 default (not recorded by the runner)                            |
| Judge model         | haiku (runner default)                                                              |
| Attempts            | 3 per case, one arm (`--ablation none`)                                             |
| Cost (agent, judge) | $1.62, $0.02                                                                        |

| Case                          | Priority | Skill loaded | Answer passed |
| ----------------------------- | -------- | ------------ | ------------- |
| `workflow-publish-main`       | high     | 3 of 3       | 3 of 3        |
| `deploy-vercel-production`    | high     | 3 of 3       | 3 of 3        |
| `release-upstream-tag`        | high     | 3 of 3       | 3 of 3        |
| `external-ci-circleci-status` | high     | 3 of 3       | 3 of 3        |
| `lookalike-pr-ci`             | medium   | 0 of 3       | 3 of 3        |

## What each case checks

- `workflow-publish-main`: after `gh workflow run publish.yml` on main, the agent waits with `workflow:Publish@main`, starting from before the dispatch, and reads the run's conclusion.
- `deploy-vercel-production`: after a merge to main, the agent waits with `deployment:production`, checks that `headSha` is the merge commit, and treats `failure`/`error` as not live.
- `release-upstream-tag`: the agent waits with `release:v3.0.0` for another repo's release.
- `external-ci-circleci-status`: the agent waits with `status:ci/circleci: build`, narrowed to the pushed commit with `sha`, because status events carry no branch.
- `lookalike-pr-ci`: the agent does not set up a hook-harness wait for a PR's checks.

## How to read the numbers

- Three attempts per case cannot separate 100% from about 70% (the 95% interval for 3 of 3 runs from 44% to 100%). Read every row as "no failures seen", not as a rate.
- There is no baseline arm. Without the plugin there is no hook-harness, so the judges fail it by construction. An agent without the plugin would poll `gh` instead, which does finish the task. The suite measures whether the plugin gets used correctly when installed, not whether it beats `gh`. A with/without run on 2026-11-28 is recorded in `HISTORY.md` and shows only this.
- `lookalike-pr-ci` loaded the skill in no attempt in this run, so it does not exercise the skill's "no pr-shepherd installed" rule. The run that prompted the rule (in `HISTORY.md`) loaded it.

## What the suite does not measure

- **Real waiting.** The eval sandbox has no network, and the plugin's MCP server has no mock, so it is not started. Agents only read the skill and say what they would run. Nothing checks that the relay returns the event.
- **Whether the App is subscribed** to Deployment status and Release. Those events arrive only after the setup in `docs/github-app.md`.
- **The CLI and MCP descriptions on their own.** Agents usually load the skill first.

## How to run it

```sh
claude plugin eval plugins/hook-harness --runs 3 --ablation none --no-publish --trust-plugin --json plugins/hook-harness/evals/results/run.json
claude plugin eval plugins/hook-harness --runs 1 --ablation none --case 'deploy-*' --no-publish --trust-plugin   # one case, cheap
```

A full run costs about $1.60 and takes 2 minutes with `-j 6`. Raw results land in `plugins/hook-harness/evals/results/`, which git ignores.

See [HISTORY.md](HISTORY.md) for every run and [AGENTS.md](AGENTS.md) for the rules.
