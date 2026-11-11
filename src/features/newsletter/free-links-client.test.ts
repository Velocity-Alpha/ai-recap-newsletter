import { describe, expect, it, vi } from "vitest";

import { checkLink } from "@/src/features/newsletter/free-links-client";

function reply(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe("checkLink", () => {
  it("asks the server about the link and returns its paywall state", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ paywall: "yes" }));

    await expect(checkLink("https://news.example/a", { fetcher })).resolves.toBe("yes");
    expect(fetcher).toHaveBeenCalledWith("/api/approval/check-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://news.example/a" }),
    });
  });

  it.each(["no", "unknown", "error"] as const)("passes the state %s through", async (state) => {
    await expect(checkLink("https://news.example/a", { fetcher: vi.fn().mockResolvedValue(reply({ paywall: state })) })).resolves.toBe(state);
  });

  it("answers error for a refused request, a reply it does not know, or a failed request", async () => {
    const link = "https://news.example/a";
    await expect(checkLink(link, { fetcher: vi.fn().mockResolvedValue(reply({ error: "Unauthorized." }, false)) })).resolves.toBe("error");
    await expect(checkLink(link, { fetcher: vi.fn().mockResolvedValue(reply({ paywall: "maybe" })) })).resolves.toBe("error");
    await expect(checkLink(link, { fetcher: vi.fn().mockRejectedValue(new Error("offline")) })).resolves.toBe("error");
  });
});
