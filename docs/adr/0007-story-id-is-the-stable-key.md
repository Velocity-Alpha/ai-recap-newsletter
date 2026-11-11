# 0007 — The story id is the stable key; `issue_stories` records what was sent

- **Status:** Accepted, 2026-11-10 (owner).
- **Background:** issues #118 and #42.

## Context

Nothing recorded which stories ran in which issue. The only trace was two date columns on the story
(`used_in_publication_date`, `queued_for_publication_date`) and the `content_json` of the issue. Before adding a
record, the key that names a story in it had to be decided.

## Decision

**`stories.id` is the stable key of a story.** It never changes and is never reused. The sent email carries it
(`data-story-id`), and publish detection matches stories by it. Other records name a story by this id.

`stories.guid` (`md5(day || link)`) stays as it is. It is only the key that stops ingestion from inserting the
same link twice on one day. Nothing new may use it as an identity.

"The same news in another row" is not answered by a key. It is answered by the story matches of
[ADR 0006](./0006-repeats-by-embeddings-and-pair-judging.md) (`story_matches`).

**`issue_stories` records what was sent**: one row for each story in each published issue, with its section, its
place in the section (from 1), the link that was sent, and whether it was the lead story.

- The rows are written at publish, from the parsed sent email, in the transaction that publishes the issue
  (`publish` in `src/pipeline/publish/publish-store.ts`, rows from `issue-stories.ts`). So the table holds what
  readers got, not what was planned. Planned stories stay in the outline and the drafts.
- A story removed in the distribution service before the send is not in the email, so it gets no row.
- A story added by hand in the distribution service has no `data-story-id`, so it gets no row.
- `is_lead` comes from the outline of the draft that the email names. It is null when the sent draft is not
  known: an email that names no draft, and the rows the migration made for past issues.
- A second copy of the email finds the issue published and writes nothing.
- The table has no foreign keys, like the other pipeline tables.

The migration filled the table for past issues from the four section arrays of `content_json`. Issues older than
2026-03-14 hold no story ids and have no rows.

## Rejected options

- **A key built from the link.** In six weeks, 74 links appeared on two or more days, and some of them were
  different news on the same page (a changelog page, a Product Hunt product page, a model page). Such a key would
  merge different news.
- **A key built from the text of the story.** That is what the repeat check does, with measured accuracy, as a
  relation between rows (`story_matches`), not as a key.

## Consequences

- The link in `issue_stories.url` is the story's `data-src-url`. A link changed by hand in the distribution
  service cannot be seen: the links of a received email are rewritten by click tracking. This limit is accepted.
- `stories.used_in_publication_date` and `stories.queued_for_publication_date` stay, and the app keeps writing
  them. The board, held stories, and the checks still read them, not `issue_stories`.
- Rollback: revert the code. The table can stay; nothing reads it.
