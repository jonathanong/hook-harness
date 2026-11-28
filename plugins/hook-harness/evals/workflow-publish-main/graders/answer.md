---
type: llm
---

PASS if the response waits for the run through hook-harness (the MCP `wait_for_events`/`get_events` tools or `hook-harness wait`) with the `workflow:Publish@main` preset or an equivalent filter (`event: workflow_run`, `action: completed`, `workflow: Publish`, branch main), takes its start point from before the dispatch (`since`, such as `--since 10m`, or a saved cursor), and reads the conclusion from the event. FAIL if it polls `gh run view`/`gh run watch`/`gh run list` in a loop, sleeps, or only checks npm repeatedly.
