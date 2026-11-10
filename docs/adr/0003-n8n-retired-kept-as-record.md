# n8n is retired; its workflows stay, disabled, as a record

- **Status:** Accepted, 2026-11-10 (owner).

Native code in this repo does every stage of the pipeline. Every AI Recap workflow in n8n is disabled and
stays there, unchanged, as a record of how the old system worked. Nothing calls n8n, and going back to it is
no longer a supported rollback. `docs/n8n-backend/` is the written record of that system.

We chose this because the workflows cost nothing to keep, and the owner wants to be able to look up how a
step used to work.

## Considered options

- **Export the workflows, then delete them and their credentials after 30 days** (the migration plan, #81).
  Rejected: an export is harder to read than the workflow in n8n, and nothing is gained by deleting.
- **Keep n8n as a live rollback.** Rejected: one issue per date (#82) already breaks n8n drafting, and a
  rollback path that nobody tests is a trap.

## Consequences

- Do not reactivate, edit, or call an AI Recap workflow. The same n8n instance runs other products; do not
  touch those either.
- Native code keeps using the same GHL, S3, OpenAI, and Vertex keys. Nothing is revoked.
- The code has no switch back to n8n: the stage-owner settings and the commit forward are removed (#147).
