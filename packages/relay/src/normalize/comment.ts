import type { Normalizer } from "../types.ts";
import { authorOf, build, commandOf } from "./common.ts";

/** Stores every issue or PR comment event. `command` is parsed from the first token; no text. */
export const issueComment: Normalizer = (payload, ctx) =>
  build("issue_comment", payload, ctx, {
    command: payload.action === "deleted" ? null : commandOf(payload.comment.body),
    commentId: payload.comment.id,
    issue: payload.issue.number,
    prs: payload.issue.pull_request ? [payload.issue.number] : [],
    author: authorOf(payload.comment.user),
    authorAssociation: payload.comment.author_association,
    url: payload.comment.html_url,
  });
