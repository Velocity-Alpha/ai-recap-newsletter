import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NewImagePanel, type NewImagePanelProps } from "@/src/components/approval/NewImagePanel";

const CURRENT = "https://example-bucket.s3.amazonaws.com/newsletter-dev/2026-05-21-old111.jpg";
const NEW_IMAGE = { imageUrl: "https://example-bucket.s3.amazonaws.com/newsletter-dev/2026-05-21-new222.jpg", scenePrompt: "A pretend lighthouse." };
const noop = () => {};

function render(props: Partial<NewImagePanelProps> = {}) {
  return renderToStaticMarkup(
    <NewImagePanel
      currentImageUrl={CURRENT}
      scene="A pretend robot at a desk."
      ideas={{ status: "loading" }}
      chat={{ turns: [], busy: false, error: null }}
      generated={null}
      busy={null}
      error={null}
      onSceneChange={noop}
      onSend={noop}
      onMake={noop}
      onRetryIdeas={noop}
      onGenerate={noop}
      onChoose={noop}
      onClose={noop}
      {...props}
    />,
  );
}

describe("NewImagePanel", () => {
  it("shows the current image and the current scene prompt in an editable box", () => {
    const html = render();

    expect(html).toMatch(new RegExp(`<img[^>]*src="${CURRENT}"`));
    expect(html).toMatch(/<textarea[^>]*>A pretend robot at a desk.<\/textarea>/);
    expect(html).not.toMatch(/<textarea[^>]*readonly/i);
    expect(html).toContain("Suggesting scene ideas…");
    expect(html).toContain("Close");
  });

  it("labels the current image without a draft number (#149)", () => {
    const html = render();

    expect(html).toMatch(/<figcaption[^>]*>Now<\/figcaption>/);
    expect(html).toContain('alt="The featured image the draft has now"');
    expect(html).not.toMatch(/\bv\d/);
  });

  it("shows each scene idea as a button that fills the box", () => {
    const html = render({
      ideas: {
        status: "ready",
        ideas: [
          { label: "Lighthouse", scene: "A pretend lighthouse." },
          { label: "Robot desk", scene: "A pretend robot at a desk." },
          { label: "Night city", scene: "A pretend city at night." },
        ],
      },
    });

    expect(html.match(/data-idea=/g)).toHaveLength(3);
    expect(html).toMatch(/<button[^>]*title="A pretend lighthouse."[^>]*>Lighthouse<\/button>/);
    expect(html).not.toContain("Suggesting scene ideas…");
  });

  it("says when the ideas failed, and offers to try again", () => {
    const html = render({ ideas: { status: "error", error: "Scene ideas failed: Request timed out." } });

    expect(html).toContain("Scene ideas failed: Request timed out.");
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
  });

  it("only lets the owner generate with a scene in the box, and shows when it is busy", () => {
    expect(render()).toMatch(/<button[^>]*>Generate<\/button>/);
    expect(render()).not.toMatch(/<button[^>]*disabled=""[^>]*>Generate<\/button>/);
    expect(render({ scene: "   " })).toMatch(/<button[^>]*disabled=""[^>]*>Generate<\/button>/);
    expect(render({ busy: "generate" })).toMatch(/<button[^>]*disabled=""[^>]*>Generating…<\/button>/);
  });

  it("offers Use this image only once an image is generated, and shows it", () => {
    expect(render()).not.toContain("Use this image");

    const html = render({ generated: NEW_IMAGE });
    expect(html).toMatch(new RegExp(`<img[^>]*src="${NEW_IMAGE.imageUrl}"`));
    expect(html).toMatch(/<button[^>]*>Use this image<\/button>/);
    expect(html).toMatch(/<button[^>]*>Generate again<\/button>/);
  });

  it("says Use this image changes this draft in place, and makes no new draft (#149)", () => {
    const html = render({ generated: NEW_IMAGE });

    expect(html).toContain("Puts this image into the draft. The text stays the same.");
    expect(html).not.toContain("new draft");
  });

  it("shows Use this image as busy while the image is saved", () => {
    const html = render({ generated: NEW_IMAGE, busy: "choose" });

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Saving…<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>Use this image<\/button>/);
    expect(html).not.toContain("Making the draft");
  });

  it("shows an error in plain words", () => {
    expect(render({ error: "Featured image failed at image: Vertex returned HTTP 429: Quota" })).toContain("Vertex returned HTTP 429: Quota");
  });

  it("shows the per-session limit in plain words, for Generate and for ideas", () => {
    expect(render({ error: "Too many images this hour. Try again in about 12 minutes." })).toContain(
      "Too many images this hour. Try again in about 12 minutes.",
    );
    const ideas = render({ ideas: { status: "error", error: "Too many scene idea requests this hour. Try again in about a minute." } });
    expect(ideas).toContain("Too many scene idea requests this hour. Try again in about a minute.");
    expect(ideas).toMatch(/<button[^>]*>Try again<\/button>/);
  });

  it("opens with the scene chat: a greeting and a box to describe the scene", () => {
    const html = render();

    expect(html).toContain("Describe the picture, or what to change.");
    expect(html).toMatch(/<input[^>]*aria-label="Describe the scene"[^>]*placeholder="e.g. a star and a sun circling each other"/);
    expect(html).toMatch(/<summary[^>]*>Write the prompt yourself<\/summary>/);
    expect(html).not.toContain("Make this image");
  });

  it("shows each helper reply with its prompt folded away and a Make this image button", () => {
    const html = render({
      chat: {
        turns: [
          { role: "owner", text: "A star and a sun circling each other." },
          { role: "helper", text: "Two bodies in a slow orbit.", scene: "A pretend orbit scene." },
        ],
        busy: false,
        error: null,
      },
    });

    expect(html).toContain("A star and a sun circling each other.");
    expect(html).toContain("Two bodies in a slow orbit.");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Prompt<\/summary><p[^>]*>A pretend orbit scene.<\/p><\/details>/);
    expect(html.match(/data-helper-turn/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*>Make this image<\/button>/);
    expect(html).toContain('placeholder="What to change?"');
  });

  it("shows the chat as busy, and its error in plain words", () => {
    const busy = render({ chat: { turns: [{ role: "owner", text: "A sun." }], busy: true, error: null } });
    expect(busy).toContain("Writing the scene…");
    expect(busy).toMatch(/<input[^>]*aria-label="Describe the scene"[^>]*disabled=""/);

    expect(render({ chat: { turns: [], busy: false, error: "Scene chat failed: Request timed out." } })).toContain("Scene chat failed: Request timed out.");
  });

  it("does not let the owner make an image from the chat while another image is being made", () => {
    const html = render({
      busy: "generate",
      chat: { turns: [{ role: "owner", text: "A sun." }, { role: "helper", text: "Done.", scene: "A sun." }], busy: false, error: null },
    });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Make this image<\/button>/);
  });

  it("says when the draft has no image yet", () => {
    expect(render({ currentImageUrl: null })).toContain("This draft has no image.");
  });
});
