---
type: llm
---

PASS if the response waits through hook-harness (MCP `wait_for_events`/`get_events` or `hook-harness wait`) with the `status:ci/circleci: build` preset or an equivalent filter (`event: status`, `context: ci/circleci: build`), narrowed to commit 9e1b77d (`sha`), and reads success or failure from the event's conclusion. FAIL if it polls `gh api .../statuses` or CircleCI in a loop, sleeps, filters by branch alone (status events carry no branch), or uses pr-shepherd for this commit on main.
