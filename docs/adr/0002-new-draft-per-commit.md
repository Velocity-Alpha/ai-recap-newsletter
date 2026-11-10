# Each commit makes a new draft and a new GHL template

- **Status:** Replaced on 2026-11-10 by [ADR 0005](./0005-draft-staged-for-sending-by-the-owner.md). Kept as a
  record. Still true: one issue per date, and each commit makes a new draft of it.

There is one issue per date, and each issue has one or more drafts. Every commit, and every accepted image
change, makes a new draft with its own new GHL email template, named like `2026-11-09 v2: <subject>`. The
latest draft is the current one, and older drafts stay listed with their GHL links. The sent email carries
a hidden draft id, so publish detection records which draft was sent.

We chose this because a GHL template is the only place the email content lives, and the owner does not want
to lose an older version or the edits made to it in GHL.

## Considered options

- **Overwrite one GHL template per date** (the migration plan's first idea). Rejected: a second commit would
  erase the earlier content and any hand edits in GHL.
- **New issue row per commit** (what n8n does). Rejected: it caused 26 never-sent duplicate issues and made
  "which issue is today's" ambiguous.
