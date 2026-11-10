import type { Normalizer } from "../types.ts";
import { mergeGroup, push } from "./branch.ts";
import { checkSuite, status, workflowRun } from "./checks.ts";
import { commitComment, issueComment, issues } from "./comment.ts";
import { generic } from "./common.ts";
import {
  pullRequest,
  pullRequestReview,
  pullRequestReviewComment,
  pullRequestReviewThread,
} from "./pull-request.ts";

/** Events with extra signals. Any other event is stored through `generic`. */
export const normalizers = new Map<string, Normalizer>([
  ["pull_request", pullRequest],
  ["pull_request_review", pullRequestReview],
  ["pull_request_review_comment", pullRequestReviewComment],
  ["pull_request_review_thread", pullRequestReviewThread],
  ["issue_comment", issueComment],
  ["issues", issues],
  ["commit_comment", commitComment],
  ["check_suite", checkSuite],
  ["workflow_run", workflowRun],
  ["status", status],
  ["merge_group", mergeGroup],
  ["push", push],
]);

export function normalizerFor(event: string): Normalizer {
  return normalizers.get(event) ?? generic(event);
}
