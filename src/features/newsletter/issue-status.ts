/**
 * `issues.status` (#82). The database computes it from `published_at`, so code only reads it.
 * Ask "is this issue published?" with the status; read `published_at` only for the time.
 */
export const ISSUE_DRAFT = "draft";
export const ISSUE_PUBLISHED = "published";
export type IssueStatus = typeof ISSUE_DRAFT | typeof ISSUE_PUBLISHED;
