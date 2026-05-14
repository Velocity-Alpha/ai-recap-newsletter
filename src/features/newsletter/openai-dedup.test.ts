import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  responses: {
    create: vi.fn(),
    retrieve: vi.fn(),
  },
}));

vi.mock("openai", () => ({
  default: vi.fn(() => clientMock),
}));

const logMock = vi.hoisted(() => ({
  logServerInfo: vi.fn(),
  logServerError: vi.fn(),
}));

vi.mock("@/src/server/observability", () => logMock);

import { submitDeduplication, checkDeduplicationStatus } from "./openai-dedup";

describe("openai-dedup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("submitDeduplication", () => {
    it("constructs request with incoming and referenced stories", async () => {
      clientMock.responses.create.mockResolvedValue({ id: "resp_123", status: "queued" });

      const input = {
        incomingStories: [
          { id: 1, headline: "AI News", summary: "New AI model", story_details: "Details..." },
          { id: 2, headline: "Tech", summary: "Tech update", story_details: null },
        ],
        referencedStories: [
          { id: 100, headline: "Old AI", summary: "Old model", story_details: "Old details" },
        ],
      };

      await submitDeduplication(input, "2026-04-24");

      expect(clientMock.responses.create).toHaveBeenCalledOnce();
      const callArgs = clientMock.responses.create.mock.calls[0][0];

      // Verify request structure
      expect(callArgs.model).toBe("gpt-4o-mini");
      expect(callArgs.background).toBe(true);
      expect(callArgs.store).toBe(true);
      expect(callArgs.instructions).toContain("duplicate news stories");

      // Verify input includes story_details
      expect(callArgs.input).toContain("incoming_stories");
      expect(callArgs.input).toContain("previously_used_stories");
      const payloadMatch = callArgs.input.match(/INPUT:\s*(\{[\s\S]*\})/);
      if (payloadMatch) {
        const payload = JSON.parse(payloadMatch[1]);
        expect(payload.incoming_stories[0]).toHaveProperty("story_details", "Details...");
        expect(payload.incoming_stories[1]).toHaveProperty("story_details", null);
        expect(payload.previously_used_stories[0]).toHaveProperty("story_details", "Old details");
      }

      // Verify structured output schema
      expect(callArgs.text.format.type).toBe("json_schema");
      expect(callArgs.text.format.strict).toBe(true);
      expect(callArgs.text.format.schema.properties).toHaveProperty("kept_story_ids");
      expect(callArgs.text.format.schema.required).toContain("kept_story_ids");
    });

    it("returns response ID on success", async () => {
      clientMock.responses.create.mockResolvedValue({ id: "resp_abc123", status: "queued" });

      const input = {
        incomingStories: [{ id: 1, headline: "Test", summary: "Test", story_details: null }],
        referencedStories: [],
      };

      const result = await submitDeduplication(input, "2026-04-24");

      expect(result).toBe("resp_abc123");
      expect(logMock.logServerInfo).toHaveBeenCalledWith(
        "openai.response.submit.success",
        expect.objectContaining({ responseId: "resp_abc123" })
      );
    });
  });

  describe("checkDeduplicationStatus", () => {
    it("maps queued status to pending", async () => {
      clientMock.responses.retrieve.mockResolvedValue({ status: "queued" });

      const result = await checkDeduplicationStatus("resp_123");

      expect(result).toEqual({ status: "pending" });
    });

    it("maps in_progress status to pending", async () => {
      clientMock.responses.retrieve.mockResolvedValue({ status: "in_progress" });

      const result = await checkDeduplicationStatus("resp_123");

      expect(result).toEqual({ status: "pending" });
    });

    it("parses completed status with valid JSON output", async () => {
      const outputJson = { kept_story_ids: [1, 3, 5] };
      clientMock.responses.retrieve.mockResolvedValue({
        status: "completed",
        output_text: JSON.stringify(outputJson),
      });

      const result = await checkDeduplicationStatus("resp_123");

      expect(result).toEqual({
        status: "completed",
        result: { kept_story_ids: [1, 3, 5] },
      });
    });

    it("returns failed status when completed but output_text is empty", async () => {
      clientMock.responses.retrieve.mockResolvedValue({
        status: "completed",
        output_text: "",
      });

      const result = await checkDeduplicationStatus("resp_123");

      expect(result.status).toBe("failed");
      expect(result.error).toContain("No output_text");
    });

    it("returns failed status when completed but output_text is not valid JSON", async () => {
      clientMock.responses.retrieve.mockResolvedValue({
        status: "completed",
        output_text: "This is not JSON",
      });

      const result = await checkDeduplicationStatus("resp_123");

      expect(result.status).toBe("failed");
      expect(result.error).toContain("Unexpected token");
    });

    it("returns failed status when response status is failed", async () => {
      clientMock.responses.retrieve.mockResolvedValue({
        status: "failed",
        error: "Model error: timeout",
      });

      const result = await checkDeduplicationStatus("resp_123");

      expect(result).toEqual({
        status: "failed",
        error: "Model error: timeout",
      });
      expect(logMock.logServerError).toHaveBeenCalledWith(
        "openai.response.status.failed",
        expect.any(Error),
        expect.objectContaining({ openaiError: "Model error: timeout" })
      );
    });

    it("returns failed with default message when response status is failed without error", async () => {
      clientMock.responses.retrieve.mockResolvedValue({
        status: "failed",
      });

      const result = await checkDeduplicationStatus("resp_123");

      expect(result.status).toBe("failed");
      expect(result.error).toBe("Response generation failed");
    });

    it("returns failed status when response status is cancelled", async () => {
      clientMock.responses.retrieve.mockResolvedValue({
        status: "cancelled",
        error: "User cancelled",
      });

      const result = await checkDeduplicationStatus("resp_123");

      expect(result.status).toBe("failed");
      expect(result.error).toBe("User cancelled");
    });

    it("returns failed status when response is expired", async () => {
      clientMock.responses.retrieve.mockResolvedValue({
        status: "expired",
      });

      const result = await checkDeduplicationStatus("resp_123");

      expect(result).toEqual({
        status: "failed",
        error: "Deduplication response expired before completion.",
      });
      expect(logMock.logServerError).toHaveBeenCalledWith(
        "openai.response.status.expired",
        expect.any(Error),
        expect.any(Object)
      );
    });

    it("defaults unknown status to pending", async () => {
      clientMock.responses.retrieve.mockResolvedValue({
        status: "unknown_future_status",
      });

      const result = await checkDeduplicationStatus("resp_123");

      expect(result).toEqual({ status: "pending" });
    });

    it("logs server info on successful retrieval", async () => {
      clientMock.responses.retrieve.mockResolvedValue({ status: "queued" });

      await checkDeduplicationStatus("resp_test");

      expect(logMock.logServerInfo).toHaveBeenCalledWith(
        "openai.response.status.check",
        expect.objectContaining({
          responseId: "resp_test",
          status: "queued",
        })
      );
    });
  });
});
