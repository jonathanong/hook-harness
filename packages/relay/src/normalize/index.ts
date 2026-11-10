import type { Normalizer } from "../types.ts";
import { mergeGroup, push } from "./branch.ts";
import { checkSuite, status, workflowRun } from "./checks.ts";
import { issueComment } from "./comment.ts";
import {
  pullRequest,
  pullRequestReview,
  pullRequestReviewComment,
  pullRequestReviewThread,
} from "./pull-request.ts";

/** Static allowlist: events absent from this map are dropped without parsing the body. */
export const normalizers = new Map<string, Normalizer>([
  ["pull_request", pullRequest],
  ["pull_request_review", pullRequestReview],
  ["pull_request_review_comment", pullRequestReviewComment],
  ["pull_request_review_thread", pullRequestReviewThread],
  ["issue_comment", issueComment],
  ["check_suite", checkSuite],
  ["workflow_run", workflowRun],
  ["status", status],
  ["merge_group", mergeGroup],
  ["push", push],
]);
