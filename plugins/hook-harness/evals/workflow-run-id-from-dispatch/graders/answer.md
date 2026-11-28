---
type: llm
---

PASS if the response waits through hook-harness (MCP `wait_for_events`/`get_events` or `hook-harness wait`) with the `workflow:Publish@main` preset or an equivalent `workflow_run` `completed` filter, takes its start point from before the dispatch (`since`, such as `--since 10m`, or a saved cursor), takes the run ID 88123456 from the printed URL, and accepts only the event whose `runId` is 88123456 (waiting again for any other run). FAIL if it starts the wait at the current time with no earlier `since` or cursor, identifies the run with `gh run list` (for example `--limit 1`) instead of the printed URL, identifies it only by commit SHA, or polls `gh run view`/`gh run watch` in a loop.
