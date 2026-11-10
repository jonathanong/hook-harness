import type { Normalizer } from "../types.ts";
import { build } from "./common.ts";

/** Stores only comments that start with an allowlisted command; never the text itself. */
export const issueComment: Normalizer = (payload, ctx) => {
  if (payload.action !== "created") return null;
  const command = payload.comment.body.trimStart().split(/\s/, 1).join("").toLowerCase();
  if (!ctx.commands.includes(command)) return null;
  return build("issue_comment", payload, ctx, {
    command,
    commentId: payload.comment.id,
    issue: payload.issue.number,
    prs: payload.issue.pull_request ? [payload.issue.number] : [],
    authorAssociation: payload.comment.author_association,
    url: payload.comment.html_url,
  });
};
