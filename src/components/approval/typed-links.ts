import { typedLinkOf, type LinkState } from "@/src/components/approval/story-links";
import type { PaywallStatus } from "@/src/pipeline/ingest/paywall";

/**
 * The links the owner types on the board (#59), and the paywall state of each. The board keeps the text of the
 * field; this keeps what was asked and what the answer was, so the rules can be tested without the board:
 * a link is checked once when the owner leaves the field, an answer for an older text is dropped, and a commit
 * can wait for the checks that still run.
 */

export interface TypedLinksOptions {
  /** Asks if a link is paywalled. Never throws. */
  checkLink: (url: string) => Promise<PaywallStatus>;
  /** Gets the states after each change: one entry for each story with a typed link. */
  onStates: (states: LinkState) => void;
  /** The typed text changed nothing (empty, or the story's own link again): the board drops the story's link edit. */
  onDropped: (id: number) => void;
}

export interface TypedLinks {
  /** The owner changed the text of the link field. The link is not checked yet, so its state is unknown. */
  type(id: number, value: string): void;
  /** The owner left the field: checks the typed link, or drops an edit that changed nothing. */
  finish(id: number, storyUrl: string | null | undefined): Promise<void>;
  /** Resolves when no check runs. */
  settle(): Promise<void>;
  /** The states now. After `settle()` they are the answers. */
  states(): LinkState;
}

export function createTypedLinks(options: TypedLinksOptions): TypedLinks {
  const typed = new Map<number, string>();
  /** The link of each story that was sent to the check, so leaving the field twice asks once. */
  const asked = new Map<number, string>();
  const running = new Set<Promise<void>>();
  let states: LinkState = {};

  const setState = (id: number, state: PaywallStatus | null) => {
    const next = { ...states };
    if (state === null) delete next[id];
    else next[id] = state;
    states = next;
    options.onStates(states);
  };

  async function check(id: number, url: string, storyUrl: string | null | undefined): Promise<void> {
    const state = await options.checkLink(url);
    const current = typed.get(id);
    // An answer for a text the owner changed since is dropped.
    if (current === undefined || typedLinkOf(current, storyUrl) !== url) return;
    // A check that failed is asked again the next time the owner leaves the field.
    if (state === "error") asked.delete(id);
    setState(id, state);
  }

  return {
    type(id, value) {
      typed.set(id, value);
      asked.delete(id);
      setState(id, "unknown");
    },

    async finish(id, storyUrl) {
      const value = typed.get(id);
      if (value === undefined) return;
      const url = typedLinkOf(value, storyUrl);
      if (url === null) {
        typed.delete(id);
        asked.delete(id);
        setState(id, null);
        options.onDropped(id);
        return;
      }
      if (asked.get(id) === url) return;
      asked.set(id, url);
      const run = check(id, url, storyUrl);
      running.add(run);
      try {
        await run;
      } finally {
        running.delete(run);
      }
    },

    async settle() {
      while (running.size > 0) await Promise.all(running);
    },

    states: () => states,
  };
}
