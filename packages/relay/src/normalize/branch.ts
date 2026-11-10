import type { Normalizer } from "../types.ts";
import { build, commitUrl, stripHeads } from "./common.ts";

const QUEUE_REF = /^refs\/heads\/gh-readonly-queue\/.+\/pr-(\d+)-[0-9a-f]+$/;

export const mergeGroup: Normalizer = (payload, ctx) => {
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

/** Pushes to any branch or tag; `headRef` keeps `refs/tags/...` for tags. */
export const push: Normalizer = (payload, ctx) =>
  build("push", payload, ctx, {
    headRef: stripHeads(payload.ref),
    headSha: payload.after,
    url: payload.compare,
  });
