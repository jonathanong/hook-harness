import type { Normalizer } from "../types.ts";
import { build, commitUrl, stripHeads } from "./common.ts";

const QUEUE_REF = /^refs\/heads\/gh-readonly-queue\/.+\/pr-(\d+)-[0-9a-f]+$/;
const MERGE_GROUP_ACTIONS = new Set(["checks_requested", "destroyed"]);

export const mergeGroup: Normalizer = (payload, ctx) => {
  if (!MERGE_GROUP_ACTIONS.has(payload.action)) return null;
  const group = payload.merge_group;
  const match = QUEUE_REF.exec(group.head_ref);
  return build("merge_group", payload, ctx, {
    prs: match ? [Number(match[1])] : [],
    headSha: group.head_sha,
    headRef: stripHeads(group.head_ref),
    baseRef: stripHeads(group.base_ref),
    reason: payload.reason ?? null,
    url: commitUrl(payload, group.head_sha),
  });
};

/** Only pushes to the repository's default branch. */
export const push: Normalizer = (payload, ctx) => {
  if (payload.ref !== `refs/heads/${payload.repository.default_branch}`) return null;
  return build("push", payload, ctx, {
    headRef: stripHeads(payload.ref),
    headSha: payload.after,
    url: payload.compare,
  });
};
