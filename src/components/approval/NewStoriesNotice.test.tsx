import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import NewStoriesNotice, { rebuildAfterWarning } from "@/src/components/approval/NewStoriesNotice";

describe("NewStoriesNotice", () => {
  it("tells the owner new stories arrived and offers a rebuild", () => {
    const html = renderToStaticMarkup(<NewStoriesNotice onRebuild={() => {}} />);

    expect(html).toContain("New stories arrived since this board was built");
    expect(html).toContain("Rebuild board");
  });

  it("warns that changes will be lost before rebuilding", () => {
    const onRebuild = vi.fn();
    const confirm = vi.fn(() => true);

    rebuildAfterWarning(onRebuild, confirm);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Changes on this board will be lost"));
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });

  it("keeps the board when the owner cancels", () => {
    const onRebuild = vi.fn();

    rebuildAfterWarning(onRebuild, () => false);

    expect(onRebuild).not.toHaveBeenCalled();
  });
});
