import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/subscriber/sign-out/route";

describe("POST /api/subscriber/sign-out", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("clears the session cookie and the signed-in hint", async () => {
    const response = await POST(new Request("http://localhost/api/subscriber/sign-out", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([
      "ai_recap_subscriber=; Path=/; Max-Age=0; HttpOnly; SameSite=lax",
      "ai_recap_signed_in=; Path=/; Max-Age=0; SameSite=lax",
    ]);
  });
});
