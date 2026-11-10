import { describe, expect, it, vi } from "vitest";

import { awaitLeadPick } from "@/src/features/newsletter/lead-pick-client";

function reply(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

const noWait = () => Promise.resolve();

describe("awaitLeadPick", () => {
  it("polls until the pick completes and returns the lead and reason", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply({ status: "processing" }))
      .mockResolvedValueOnce(reply({ status: "completed", lead_id: 7, reason: "A once-in-a-lifetime IPO." }));

    await expect(awaitLeadPick("resp_lead", { fetcher, wait: noWait })).resolves.toEqual({
      leadId: 7,
      reason: "A once-in-a-lifetime IPO.",
    });
    expect(fetcher).toHaveBeenCalledWith("/api/approval/outline/lead?response_id=resp_lead", { cache: "no-store" });
  });

  it("gives up with null on an error, a bad reply, a thrown fetch or too many polls", async () => {
    await expect(
      awaitLeadPick("r", { fetcher: vi.fn().mockResolvedValue(reply({ status: "error" })), wait: noWait })
    ).resolves.toBeNull();
    await expect(awaitLeadPick("r", { fetcher: vi.fn().mockResolvedValue(reply({}, false)), wait: noWait })).resolves.toBeNull();
    await expect(
      awaitLeadPick("r", { fetcher: vi.fn().mockRejectedValue(new Error("offline")), wait: noWait })
    ).resolves.toBeNull();

    const fetcher = vi.fn().mockResolvedValue(reply({ status: "processing" }));
    await expect(awaitLeadPick("r", { fetcher, wait: noWait, maxPolls: 3 })).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("stops when the board is gone", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ status: "processing" }));
    await expect(awaitLeadPick("r", { fetcher, wait: noWait, isActive: () => false })).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
