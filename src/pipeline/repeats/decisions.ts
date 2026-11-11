/**
 * The judge of the repeat check (#90): two yes/no questions for each pair of stories, sent to the OpenAI Decisions
 * API. The installed `openai` package (6.x) has no method for this endpoint, so it is called with `fetch`.
 * Guide: https://developers.openai.com/api/docs/guides/decisions
 *
 * The recorded answers in `__fixtures__/` were made with exactly this request. If a text changes, record them again.
 */

export const DECISIONS_MODEL = "gpt-6-luna";
const DECISIONS_URL = "https://api.openai.com/v1/decisions";
const TIMEOUT_MS = 20_000;
const RETRY_WAITS_MS = [1_000, 3_000];

const DEVELOPER_MESSAGE =
  "You compare short news stories for a daily AI newsletter. Story A is the newer story. Each question gives one older story, Story B. Judge only from the text.";
export const SAME_QUESTION =
  "Do Story A and Story B report the same underlying development: the same event, announcement, release, filing, funding round, paper, ruling, or product launch? Answer yes even when the source, wording, or level of detail differs, or when one is only a short product listing. Answer no when they only share a company, product, person, or topic, and no when one of them reports a new development that the other does not.";
export const NEWS_QUESTION =
  "Does Story A report a materially new development that Story B does not report: a next step, a result, a ruling, a completed deal, changed numbers, a response by another party, or a reversal? Answer no when Story A repeats the news of Story B with different wording, a different source, or small extra details.";

/** The text of a story the judge reads. */
export interface JudgedStory {
  id: number;
  headline: string;
  summary: string;
}
export interface PairAnswer {
  olderId: number;
  same: number;
  news: number;
}
/** One request: the newer story, and each older story it pairs with. Answers only for the pairs not refused. */
export type JudgePairs = (newer: JudgedStory, olders: JudgedStory[]) => Promise<PairAnswer[]>;

interface DecisionAnswer {
  type: string;
  name: string;
  probability?: number;
}

export function createPairJudge(options: {
  apiKey: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): JudgePairs {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function post(body: string): Promise<{ answers: DecisionAnswer[] }> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(DECISIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return (await response.json()) as { answers: DecisionAnswer[] };
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < RETRY_WAITS_MS.length) {
        await sleep(RETRY_WAITS_MS[attempt]);
        continue;
      }
      const text = await response.text().catch(() => "");
      throw new Error(`Decisions API: HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
  }

  return async (newer, olders) => {
    if (olders.length === 0) return [];
    const questions = olders.flatMap((older) => {
      const storyB = `Story B:\n${older.headline}\n${older.summary}\n\n`;
      return [
        { type: "predicate", name: `same:${older.id}`, instructions: `${storyB}${SAME_QUESTION}` },
        { type: "predicate", name: `news:${older.id}`, instructions: `${storyB}${NEWS_QUESTION}` },
      ];
    });
    const body = JSON.stringify({
      model: DECISIONS_MODEL,
      input: [
        { role: "developer", content: DEVELOPER_MESSAGE },
        { role: "user", content: `Story A:\n${newer.headline}\n${newer.summary}` },
      ],
      questions,
    });
    const { answers } = await post(body);
    if (!Array.isArray(answers) || answers.length !== questions.length) {
      throw new Error(`Decisions API: asked ${questions.length} questions, got ${Array.isArray(answers) ? answers.length : "no"} answers.`);
    }
    answers.forEach((answer, index) => {
      if (answer.name !== questions[index].name) {
        throw new Error(`Decisions API: answer ${index} is ${answer.name}, expected ${questions[index].name}.`);
      }
    });

    const probability = (answer: DecisionAnswer) =>
      answer.type === "predicate" && typeof answer.probability === "number" ? answer.probability : null;
    const result: PairAnswer[] = [];
    olders.forEach((older, index) => {
      const same = probability(answers[2 * index]);
      const news = probability(answers[2 * index + 1]);
      if (same !== null && news !== null) result.push({ olderId: older.id, same, news });
    });
    return result;
  };
}
