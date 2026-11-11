# AI Recap

AI Recap is a weekday AI newsletter. This glossary covers the editorial pipeline, from collecting stories to
publishing an issue, and the operations that watch it.

## Editorial

**Source**:
A newsletter or feed that stories are collected from.
_Avoid_: provider, sender

**Beehiiv site source**:
A kind of source read from a beehiiv publication's public website instead of email. In the World of AI is
one. Each publication has its own source key.
_Avoid_: beehiiv (as a source name), subscriber provider (that is the subscriber list)

**Story**:
One news item taken from a source for one day, with a headline, summary, and link. Its id never changes and is
the key other records use.
_Avoid_: item, post

**Article**:
The web page a story links to. The writer reads it to get the full facts behind the story.
_Avoid_: source (that is the newsletter), link

**Board**:
The page where the owner picks a date's stories, puts them into sections, and commits the outline.
_Avoid_: approval page, outline UI

**Section**:
One part of an issue: Top Stories, Research & Analysis, Tools, or Quick Hits.
_Avoid_: category (a story's source category is a different thing)

**Feature section**:
Top Stories or Research & Analysis. Each story in a feature section gets a longer write-up with three bullets.

**Lead story**:
The story the issue's subject line is based on.
_Avoid_: headline (that is a section and a story field), top story

**Proposed lead**:
The lead story the board pre-sets for a date. The lead score (importance, how many sources covered it, and the
owner's editorial rubric) shortlists candidates and pre-sets the best one; the AI lead pick then chooses from
the shortlist and replaces it unless the owner has edited the board. The owner can change it before committing.
_Avoid_: default headline

**Coverage**:
The number of different sources that sent the same story.
_Avoid_: mentions, overlap

**Candidate**:
A story the board can propose for a date: recent, important enough, never published, and not excluded.
_Avoid_: pool item, incoming story

**Repeat**:
A candidate that reports the same news as a story of an earlier issue (in the repeat window, 14 days by
default) or of an unsent draft.
_Avoid_: dupe, already published

**Duplicate**:
A candidate that reports the same news as another candidate on the same board. The board shows one story for the
group, the **head**: the highest-ranked one. The others go in its `also_from` list.
_Avoid_: repeat (that is against earlier issues)

**Similar story**:
A candidate that looks like an earlier story, but the check is not sure. It stays on the board with a label.
_Avoid_: possible repeat, near-duplicate

**Story match**:
One stored comparison of two stories: how alike they are, and the two answers of the judge (`same`, `news`).
_Avoid_: pair score, dedup result

**Repeat check**:
The step that compares each new story with its nearest stories of the window and stores the story matches. Not
a **Check** (those are scheduled tests of outcomes).
_Avoid_: dedup, duplicate check

**Original link**:
The link a story had when it was ingested. It is kept when a commit changes the story's link.
_Avoid_: old link, source link

**Free link**:
A link to an article that reports the same news as a story, that the app could read, and that has 300 words or
more. It replaces a paywalled link.
_Avoid_: alternative link, mirror

**Learned paywalled site**:
A site the article reader found paywalled on two different stories. The paywall check then treats it as
paywalled, unless the owner ignores it.
_Avoid_: blocked site, blacklist

**Outline**:
The owner's chosen stories for one date: sections, lead story, and any note or link edits.
_Avoid_: selection, payload

**Commit**:
The owner's approval of an outline, which starts drafting.
_Avoid_: submit, approve

**Issue**:
The newsletter for one date. There is at most one issue per date.
_Avoid_: edition, campaign. Say "GitHub issue" for a ticket.

**Draft**:
The working copy of an issue: body, title, and image. A commit makes it. The owner can change its title and
its image. Nothing outside the app sees it. The newest draft of an issue is the current one.
_Avoid_: template, version, preview

**Stage for sending**:
The owner's click that copies the current draft into the distribution service.
_Avoid_: push, export, publish. "Stage" alone is a pipeline step (see Operations).

**Staged version**:
One exact combination of body, title, and image that was staged for sending. Numbered v1, v2, ... for each
issue. It never changes after it is made.
_Avoid_: template, draft version

**Distribution service**:
The outside service that sends the issue email. GHL today.
_Avoid_: email provider, ESP

**Featured image**:
The illustration at the top of an issue.
_Avoid_: hero image, cover

**Scene prompt**:
The part of the image prompt that describes the day's picture. The owner can edit it.

**Style prompt**:
The fixed part of the image prompt that gives every featured image the same watercolor look.

**Send**:
The owner's act of sending an issue's email to subscribers from GHL.
_Avoid_: publish

**Published**:
The state of an issue once its sent email has reached the seed inbox, or the owner has marked it published.
The issue then shows on the website. Until then the issue is a draft (`issues.status`).
_Avoid_: sent, live

**Skipped date**:
A weekday on which the owner chose not to publish an issue.
_Avoid_: holiday, day off

## Operations

**Stage**:
One step of the daily pipeline: ingest, draft, or publish.

**Seed inbox**:
The mailbox that receives a copy of every sent issue. Its copy is how the system knows an issue was sent.

**Run**:
One execution of a job, with its steps and result.

**Check**:
A scheduled test of an outcome (stories are present, the issue is approved, the issue is published), not of
whether a job ran.
_Avoid_: monitor, health check

**Incident**:
One ongoing problem found by a check or a job. It stays open until the check passes again.
_Avoid_: error, issue

**Alert**:
A message to the owner about an incident.
_Avoid_: notification, ping

**Heartbeat**:
A daily signal to an outside service. If it stops, that service emails the owner.
_Avoid_: check-in, dead-man switch
