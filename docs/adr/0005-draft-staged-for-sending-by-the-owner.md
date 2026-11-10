# A draft is staged for sending by the owner

- **Status:** Accepted, 2026-11-10 (owner). Replaces [ADR 0002](./0002-new-draft-per-commit.md).

A commit makes a draft and nothing else: the draft lives only in the app. The owner reviews it there and can
change its title and its image; each change edits the same draft. Only the owner's click on "Stage for
sending" creates an email in the distribution service (GHL today). Each click makes the issue's next staged
version, v1, v2, ..., named like `2026-11-09 v2: <title>`. A staged version keeps its own copy of the title,
image, content, and HTML, and never changes after it is made. The owner still sends the email by hand in the
distribution service.

The staged email carries a hidden staged version id, so publish detection records which staged version was
sent, and the site shows that version.

We chose this because a commit used to create a GHL template at once, and each image change created another.
The owner then had to find the right one among several templates, most of which were never meant to be sent.
Now an email exists in the distribution service only when the owner decides the draft is ready to send.

## Considered options

- **Keep a new draft and a new GHL template for each commit and image change** (ADR 0002). Rejected: it filled
  GHL with templates nobody sends, and a title could only be changed in GHL, where the app does not see it.
- **Overwrite one email per date in the distribution service.** Rejected, as in ADR 0002: it would erase an
  earlier version and any hand edits made to it in the service.
- **Lock the draft once it is staged.** Rejected: the owner wants to fix a title or an image after staging.
  Staging again makes the next version, and the page says when the draft changed after the last staging.

## Consequences

- The draft job never calls the distribution service. It tells the review group when a draft is ready.
- A title or image change makes no new draft row, starts no job, and calls no outside service.
- An older staged version is never changed or deleted, in the app or in the distribution service.
- Nothing locks before the issue is published. Once it is published, the title, the image, and staging are
  all refused.
- Code outside the distribution module and `ghl-template.ts` does not name GHL. A second service is one new
  implementation of `DistributionService`.
- `issue_drafts.ghl_template_id`, `ghl_preview_url`, and `source_draft_id` stay in the table, unused, until a
  later change drops them.
