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
One news item taken from a source for one day, with a headline, summary, and link.
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
One generated version of an issue's email, with its own GHL template. Each commit, and each accepted image
change, makes a new draft. The latest draft is the current one.
_Avoid_: template (GHL's copy of a draft), version, preview

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
