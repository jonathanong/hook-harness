import type { Normalizer } from "../types.ts";
import { build, commitUrl } from "./common.ts";

export const checkSuite: Normalizer = (payload, ctx) => {
  const suite = payload.check_suite;
  return build("check_suite", payload, ctx, {
    prs: suite.pull_requests.map((pr: { number: number }) => pr.number),
    headSha: suite.head_sha,
    headRef: suite.head_branch,
    conclusion: suite.conclusion,
    app: suite.app.slug,
    checkSuiteId: suite.id,
    url: commitUrl(payload, suite.head_sha),
  });
};

export const workflowRun: Normalizer = (payload, ctx) => {
  const run = payload.workflow_run;
  return build("workflow_run", payload, ctx, {
    prs: run.pull_requests.map((pr: { number: number }) => pr.number),
    headSha: run.head_sha,
    headRef: run.head_branch,
    conclusion: run.conclusion,
    workflow: run.name,
    workflowId: run.workflow_id,
    runId: run.id,
    url: run.html_url,
  });
};

export const status: Normalizer = (payload, ctx) =>
  build("status", payload, ctx, {
    headSha: payload.sha,
    conclusion: payload.state,
    url: payload.commit.html_url,
  });
