---
type: llm
---

PASS if the response does not set up a hook-harness wait (no `wait_for_events`, `get_events`, `hook-harness wait`, or a workflow/status/check_suite preset) for the PR's checks: it hands PR checks to pr-shepherd, or otherwise uses a PR-native check. FAIL if it waits on PR checks through hook-harness.
