import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceFns = vi.hoisted(() => ({
  unsubscribeSubscriberByToken: vi.fn(),
}));

vi.mock("@/features/subscriber/service", () => serviceFns);

import { GET, POST } from "./route";

describe("/api/subscriber/unsubscribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a token from the query string", async () => {
    serviceFns.unsubscribeSubscriberByToken.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/subscriber/unsubscribe?token=signed-token"));
    const json = await response.json();

    expect(serviceFns.unsubscribeSubscriberByToken).toHaveBeenCalledWith({
      token: "signed-token",
    });
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("accepts a token from the json body", async () => {
    serviceFns.unsubscribeSubscriberByToken.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/subscriber/unsubscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: "signed-token" }),
      }),
    );
    const json = await response.json();

    expect(serviceFns.unsubscribeSubscriberByToken).toHaveBeenCalledWith({
      token: "signed-token",
    });
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });
});
