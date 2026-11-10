import type { Envelope } from "./types.ts";

type Required = Pick<Envelope, "id" | "receivedAt" | "event" | "repo">;

/**
 * An envelope with every optional signal unset. Normalizers and tests fill in what applies.
 * `owner` defaults to the repo's owner.
 */
export function emptyEnvelope(fields: Required & Partial<Envelope>): Envelope {
  return {
    v: 1,
    owner: fields.repo?.split("/")[0] ?? "",
    action: null,
    prs: [],
    issue: null,
    headSha: null,
    headRef: null,
    baseRef: null,
    reason: null,
    conclusion: null,
    workflow: null,
    workflowId: null,
    runId: null,
    command: null,
    commentId: null,
    sender: null,
    author: null,
    authorAssociation: null,
    url: null,
    ...fields,
  };
}
