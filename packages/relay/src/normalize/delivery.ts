import type { Normalizer } from "../types.ts";
import { build } from "./common.ts";

export const deployment: Normalizer = (payload, ctx) => {
  const d = payload.deployment;
  return build("deployment", payload, ctx, {
    headSha: d.sha,
    headRef: d.ref,
    environment: d.environment,
    url: d.url,
  });
};

/** `state` (success, failure, error, pending, ...) is the conclusion. */
export const deploymentStatus: Normalizer = (payload, ctx) => {
  const status = payload.deployment_status;
  const d = payload.deployment;
  return build("deployment_status", payload, ctx, {
    headSha: d.sha,
    headRef: d.ref,
    environment: status.environment ?? d.environment,
    conclusion: status.state,
    url: status.target_url || status.environment_url || null,
  });
};

/** `target_commitish` is the branch (or SHA) the release's tag was cut from. */
export const release: Normalizer = (payload, ctx) => {
  const r = payload.release;
  return build("release", payload, ctx, {
    tag: r.tag_name,
    headRef: r.target_commitish,
    url: r.html_url,
  });
};
