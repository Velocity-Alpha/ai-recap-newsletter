import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DraftTitle, { DraftTitleField, type DraftTitleFieldProps } from "@/src/components/approval/DraftTitle";

const SAVED = "Pretend Lab Ships Planner";
const noop = () => {};

function render(props: Partial<DraftTitleFieldProps> = {}) {
  return renderToStaticMarkup(
    <DraftTitleField value={SAVED} saved={SAVED} busy={false} error={null} onChange={noop} onSave={noop} onReset={noop} {...props} />,
  );
}

const SAVE = /<button[^>]*type="submit"[^>]*>Save<\/button>/;
const SAVE_OFF = /<button[^>]*type="submit"[^>]*disabled=""[^>]*>Save<\/button>/;
const CANCEL = /<button[^>]*type="button"[^>]*>Cancel<\/button>/;

describe("DraftTitleField", () => {
  it("shows the title in a labelled text field", () => {
    const html = render();

    expect(html).toMatch(/<label[^>]*for="draft-title"[^>]*>Title<\/label>/);
    expect(html).toMatch(/<input[^>]*id="draft-title"[^>]*type="text"[^>]*value="Pretend Lab Ships Planner"/);
    expect(html).not.toMatch(/<input[^>]*disabled=""/);
  });

  it("shows no Save or Cancel while the title is as saved", () => {
    const html = render();

    expect(html).not.toMatch(SAVE);
    expect(html).not.toMatch(CANCEL);
    expect(html).not.toContain("Changes this draft.");
  });

  it("offers Save and Cancel once the title differs, and says it makes no new draft", () => {
    const html = render({ value: "Pretend Lab Ships a Planner" });

    expect(html).toMatch(SAVE);
    expect(html).not.toMatch(SAVE_OFF);
    expect(html).toMatch(CANCEL);
    expect(html).toContain("Changes this draft. It makes no new draft.");
  });

  it("does not count extra spaces as a change: the server stores the title on one line, trimmed", () => {
    expect(render({ value: "  Pretend   Lab Ships\tPlanner  " })).not.toMatch(SAVE);
  });

  it("does not let the owner save an empty title, but lets them cancel", () => {
    for (const value of ["", "   "]) {
      const html = render({ value });

      expect(html).toMatch(SAVE_OFF);
      expect(html).toMatch(CANCEL);
      expect(html).not.toMatch(/<button[^>]*type="button"[^>]*disabled=""[^>]*>Cancel<\/button>/);
    }
  });

  it("shows it is saving, with the field and both buttons turned off", () => {
    const html = render({ value: "Pretend Lab Ships a Planner", busy: true });

    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Saving…<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*disabled=""[^>]*>Cancel<\/button>/);
    expect(html).toMatch(/<input[^>]*disabled=""/);
    expect(html).not.toMatch(SAVE);
  });

  it("keeps showing Saving… while busy, even when the value matches the saved title", () => {
    expect(render({ busy: true })).toMatch(/<button[^>]*disabled=""[^>]*>Saving…<\/button>/);
  });

  it("shows an error in plain words, next to the title the owner typed", () => {
    const error = 'Another issue already uses the title "Pretend Lab Ships a Planner", and titles must be unique. Use a different title.';
    const html = render({ value: "Pretend Lab Ships a Planner", error });

    expect(html).toContain("Another issue already uses the title &quot;Pretend Lab Ships a Planner&quot;");
    expect(html).toContain("Use a different title.");
    expect(html).toMatch(/<input[^>]*value="Pretend Lab Ships a Planner"/);
    expect(html).toMatch(SAVE);
  });

  it("shows no error note when there is none", () => {
    expect(render({ value: "Pretend Lab Ships a Planner" })).not.toContain("whitespace-pre-wrap");
  });
});

describe("DraftTitle", () => {
  it("starts with the draft's title in the field, and nothing to save", () => {
    const html = renderToStaticMarkup(<DraftTitle draftId={41} title={SAVED} />);

    expect(html).toMatch(/<input[^>]*id="draft-title"[^>]*value="Pretend Lab Ships Planner"/);
    expect(html).not.toMatch(SAVE);
    expect(html).not.toMatch(CANCEL);
  });
});
