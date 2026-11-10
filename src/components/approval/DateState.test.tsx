import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DateState from "@/src/components/approval/DateState";
import type { IssueState } from "@/src/pipeline/distribution/issue-state";
import type { DateDraftsView, StagedVersionEntry } from "@/src/pipeline/draft/draft-board";

const DATE = "2026-05-21";

function staged(data: Partial<StagedVersionEntry> = {}): StagedVersionEntry {
  return {
    id: 9,
    version: 2,
    title: "Second Take",
    stagedAt: "2026-05-21T14:00:00.000Z",
    serviceName: "Pretend Mail",
    serviceUrl: "https://mail.example.test/emails/2",
    latest: true,
    sent: false,
    ...data,
  };
}

function render(state: IssueState, data: Partial<DateDraftsView> = {}): string {
  return renderToStaticMarkup(<DateState date={DATE} view={{ state, currentDraft: { id: 41, edited: false }, stagedVersions: [], ...data }} />);
}

describe("DateState", () => {
  it.each([
    [{ kind: "drafting" }, "Drafting"],
    [{ kind: "draft_failed" }, "Draft failed"],
    [{ kind: "draft_ready" }, "Draft ready"],
    [{ kind: "published" }, "Published"],
  ] as Array<[IssueState, string]>)("shows the state %j as %s, with a link to the date's draft page", (state, text) => {
    const html = render(state);

    expect(html).toContain(text);
    expect(html).toContain(`data-date-state="${state.kind}"`);
    expect(html).toContain('href="/approval/drafts?date=2026-05-21"');
    expect(html).toContain("Open the draft");
  });

  it("shows no outline without a link, since there is no draft to open", () => {
    const html = render({ kind: "no_outline" }, { currentDraft: null });

    expect(html).toContain("No outline");
    expect(html).not.toContain("href=");
  });

  it("shows the staged version with its time and the link to open it in the distribution service", () => {
    const html = render({ kind: "staged", version: 2, changedSinceStaged: false }, { stagedVersions: [staged(), staged({ id: 8, version: 1, latest: false, serviceUrl: "https://mail.example.test/emails/1" })] });

    expect(html).toContain("Staged, v2");
    expect(html).toContain("10:00 AM");
    expect(html).toContain('href="https://mail.example.test/emails/2"');
    expect(html).toContain("Open in Pretend Mail");
    expect(html).not.toContain("emails/1");
    expect(html).not.toContain("The draft changed");
  });

  it("adds that the draft changed after it was staged", () => {
    const html = render({ kind: "staged", version: 2, changedSinceStaged: true }, { stagedVersions: [staged()] });

    expect(html).toContain("The draft changed after v2 was staged.");
  });

  it("shows a staged version without a service link", () => {
    const html = render({ kind: "staged", version: 2, changedSinceStaged: false }, { stagedVersions: [staged({ serviceUrl: null })] });

    expect(html).toContain("Staged, v2");
    expect(html).not.toContain("Open in");
  });
});
