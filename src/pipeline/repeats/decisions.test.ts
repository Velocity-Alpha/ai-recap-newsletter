import { describe, expect, it, vi } from "vitest";
import { createPairJudge } from "@/src/pipeline/repeats/decisions";

// Written out in full on purpose: the recorded answers in __fixtures__/ were made with exactly these texts.
const SAME =
  "Do Story A and Story B report the same underlying development: the same event, announcement, release, filing, funding round, paper, ruling, or product launch? Answer yes even when the source, wording, or level of detail differs, or when one is only a short product listing. Answer no when they only share a company, product, person, or topic, and no when one of them reports a new development that the other does not.";
const NEWS =
  "Does Story A report a materially new development that Story B does not report: a next step, a result, a ruling, a completed deal, changed numbers, a response by another party, or a reversal? Answer no when Story A repeats the news of Story B with different wording, a different source, or small extra details.";

const newer = { id: 20, headline: "New headline", summary: "New summary." };
const olders = [
  { id: 10, headline: "Old one", summary: "Summary one." },
  { id: 11, headline: "Old two", summary: "Summary two." },
];

function respond(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

const okBody = {
  model: "gpt-6-luna",
  answers: [
    { type: "predicate", name: "same:10", probability: 0.98 },
    { type: "predicate", name: "news:10", probability: 0.02 },
    { type: "predicate", name: "same:11", probability: 0.1 },
    { type: "predicate", name: "news:11", probability: 0.9 },
  ],
  usage: { input_tokens: 420, output_tokens: 0, total_tokens: 420 },
};

function judgeWith(fetchImpl: typeof fetch) {
  const sleep = vi.fn(async () => undefined);
  return { judge: createPairJudge({ apiKey: "key", fetch: fetchImpl, sleep }), sleep };
}

describe("judgePairs", () => {
  it("sends exactly the agreed request and reads the answers by position", async () => {
    const fetchMock = vi.fn(async () => respond(200, okBody));
    const { judge } = judgeWith(fetchMock as unknown as typeof fetch);

    await expect(judge(newer, olders)).resolves.toEqual([
      { olderId: 10, same: 0.98, news: 0.02 },
      { olderId: 11, same: 0.1, news: 0.9 },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/decisions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer key", "Content-Type": "application/json" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-6-luna",
      input: [
        {
          role: "developer",
          content:
            "You compare short news stories for a daily AI newsletter. Story A is the newer story. Each question gives one older story, Story B. Judge only from the text.",
        },
        { role: "user", content: "Story A:\nNew headline\nNew summary." },
      ],
      questions: [
        { type: "predicate", name: "same:10", instructions: `Story B:\nOld one\nSummary one.\n\n${SAME}` },
        { type: "predicate", name: "news:10", instructions: `Story B:\nOld one\nSummary one.\n\n${NEWS}` },
        { type: "predicate", name: "same:11", instructions: `Story B:\nOld two\nSummary two.\n\n${SAME}` },
        { type: "predicate", name: "news:11", instructions: `Story B:\nOld two\nSummary two.\n\n${NEWS}` },
      ],
    });
  });

  it("drops a pair when one of its answers is a refusal", async () => {
    const body = { ...okBody, answers: [...okBody.answers] };
    body.answers[1] = { type: "refusal", name: "news:10" } as never;
    const { judge } = judgeWith(vi.fn(async () => respond(200, body)) as unknown as typeof fetch);
    await expect(judge(newer, olders)).resolves.toEqual([{ olderId: 11, same: 0.1, news: 0.9 }]);
  });

  it("throws when an answer's name is not the question at its position", async () => {
    const body = { ...okBody, answers: [okBody.answers[1], okBody.answers[0], ...okBody.answers.slice(2)] };
    const { judge } = judgeWith(vi.fn(async () => respond(200, body)) as unknown as typeof fetch);
    await expect(judge(newer, olders)).rejects.toThrow(/answer 0 is news:10, expected same:10/);
  });

  it("tries again on 429 and 5xx, waiting 1 s then 3 s", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(429, "slow down"))
      .mockResolvedValueOnce(respond(503, "unavailable"))
      .mockResolvedValueOnce(respond(200, okBody));
    const { judge, sleep } = judgeWith(fetchMock as unknown as typeof fetch);
    await expect(judge(newer, olders)).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [3000]]);
  });

  it("gives up after 2 more tries", async () => {
    const fetchMock = vi.fn(async () => respond(500, "broken"));
    const { judge } = judgeWith(fetchMock as unknown as typeof fetch);
    await expect(judge(newer, olders)).rejects.toThrow("Decisions API: HTTP 500: broken");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws on 400 with the status and the start of the body, without trying again", async () => {
    const fetchMock = vi.fn(async () => respond(400, `bad request ${"x".repeat(400)}`));
    const { judge } = judgeWith(fetchMock as unknown as typeof fetch);
    const error = await judge(newer, olders).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`Decisions API: HTTP 400: ${`bad request ${"x".repeat(400)}`.slice(0, 300)}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for no older stories", async () => {
    const fetchMock = vi.fn();
    const { judge } = judgeWith(fetchMock as unknown as typeof fetch);
    await expect(judge(newer, [])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
