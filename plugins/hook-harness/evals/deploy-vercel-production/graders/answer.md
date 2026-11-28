---
type: llm
---

PASS if the response waits through hook-harness (MCP `wait_for_events`/`get_events` or `hook-harness wait`) for the deployment with the `deployment:production` preset (optionally `@main`) or an equivalent filter (`event: deployment_status`, `environment: production`, finished states), and checks that the event's commit (`headSha` or a `sha` filter) is 4f2a9c1 before running the smoke tests, and treats a `failure` or `error` conclusion as not live. FAIL if it polls the Vercel or GitHub deployments API in a loop, sleeps, or waits on a workflow_run instead of the deployment.
