/** The board's side of the AI lead pick (#58): polls /api/approval/outline/lead until the pick arrives. */

export type LeadPick = { leadId: number; reason: string };

type LeadPickReply = { status?: string; lead_id?: unknown; reason?: unknown };

interface AwaitLeadPickOptions {
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  wait?: (ms: number) => Promise<void>;
  /** False once the board unmounts or rebuilds. */
  isActive?: () => boolean;
  maxPolls?: number;
}

/**
 * Resolves to the AI's pick, or null when it fails, times out (about a minute) or the board goes away. Null means
 * the board keeps its scored lead; it never throws.
 */
export async function awaitLeadPick(responseId: string, options: AwaitLeadPickOptions = {}): Promise<LeadPick | null> {
  const {
    fetcher = (url, init) => fetch(url, init),
    wait = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    isActive = () => true,
    maxPolls = 30,
  } = options;
  const url = `/api/approval/outline/lead?${new URLSearchParams({ response_id: responseId })}`;

  for (let poll = 0; poll < maxPolls && isActive(); poll += 1) {
    try {
      const response = await fetcher(url, { cache: "no-store" });
      if (!response.ok) return null;
      const reply = (await response.json()) as LeadPickReply;
      if (reply.status === "completed" && Number.isInteger(reply.lead_id) && typeof reply.reason === "string") {
        return { leadId: reply.lead_id as number, reason: reply.reason };
      }
      if (reply.status !== "processing") return null;
    } catch {
      return null;
    }
    await wait(2000);
  }
  return null;
}
