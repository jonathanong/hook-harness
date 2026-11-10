import type { Normalizer } from "../types.ts";
import { authorOf, build, commandOf } from "./common.ts";

/** Stores every issue or PR comment event. `command` is parsed from the first token. */
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

/** Commit comments carry the commit SHA as `headSha`; `command` is parsed like issue comments. */
export const commitComment: Normalizer = (payload, ctx) =>
  build("commit_comment", payload, ctx, {
    command: commandOf(payload.comment.body),
    commentId: payload.comment.id,
    headSha: payload.comment.commit_id,
    author: authorOf(payload.comment.user),
    authorAssociation: payload.comment.author_association,
    url: payload.comment.html_url,
  });

/** Issue lifecycle (opened, labeled, closed, ...). Title and body stay in the payload. */
export const issues: Normalizer = (payload, ctx) =>
  build("issues", payload, ctx, {
    issue: payload.issue.number,
    author: authorOf(payload.issue.user),
    authorAssociation: payload.issue.author_association,
    url: payload.issue.html_url,
  });
