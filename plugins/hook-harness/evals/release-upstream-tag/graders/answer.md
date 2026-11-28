---
type: llm
---

PASS if the response waits through hook-harness (MCP `wait_for_events`/`get_events` or `hook-harness wait`) with the `release:v3.0.0` preset or an equivalent filter (`event: release`, `action: published`, `tag: v3.0.0`), scoped to owner acme (optionally repo acme/sdk). FAIL if it polls `gh release view`, `npm view` or the releases API in a loop, or sleeps.
