import type { Envelope } from "./types.ts";

/** An envelope with every optional signal unset. Normalizers and tests fill in what applies. */
export function emptyEnvelope(
  fields: Pick<Envelope, "id" | "receivedAt" | "event" | "repo"> & Partial<Envelope>,
): Envelope {
  return {
    v: 1,
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
    authorAssociation: null,
    url: null,
    ...fields,
  };
}
