/**
 * The browser code of the golden-set labeling page (#177). It reads the page data, sends key presses to the label
 * logic (`labels.ts`), saves the session in the browser after every change, and exports the labels as one JSON file.
 * `build-batch.ts` bundles this file into the page. Every rule about labels is in `labels.ts`; this file only draws.
 */
import {
  exportLabels,
  press,
  remaining,
  startSession,
  typeReason,
  type Kind,
  type SavedSession,
  type Session,
} from "@/evals/section-scoring/labels";
import type { PageData } from "@/evals/section-scoring/page";

const KINDS: { kind: Kind; key: string; label: string }[] = [
  { kind: "general", key: "g", label: "Top Stories kind" },
  { kind: "research", key: "r", label: "Research" },
  { kind: "tools", key: "t", label: "Tools" },
  { kind: "none", key: "n", label: "Not a story" },
];
const STATE_WORDS = { confirmed: "confirmed", overridden: "overridden", either: "either is fine", unprompted: "labeled" };

const data = JSON.parse(document.getElementById("page-data")!.textContent!) as PageData;
const storageKey = `section-labels:${data.batch}:${data.scoringVersion}`;
const app = document.getElementById("app")!;
const progress = document.getElementById("progress")!;

function load(): SavedSession | undefined {
  try {
    const text = localStorage.getItem(storageKey);
    return text ? (JSON.parse(text) as SavedSession) : undefined;
  } catch {
    return undefined;
  }
}

let session: Session = startSession(
  data.stories.map((story) => ({ id: story.id, inputHash: story.inputHash, recommendation: story.recommendation })),
  load(),
);
const reason = document.createElement("input");
reason.type = "text";
reason.placeholder = "Why? A few words. No private detail: this goes into the public repo.";
// No redraw while typing: a redraw moves the box and takes the focus away from it.
reason.addEventListener("input", () => {
  session = typeReason(session, reason.value);
});

function el(tag: string, className = "", text = ""): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function chip(key: string, label: string, classes: string[]): HTMLElement {
  const node = el("span", ["chip", ...classes].join(" "));
  node.append(el("kbd", "", key), document.createTextNode(label));
  return node;
}

let status: HTMLElement | null = null;

function drawStatus() {
  if (!status) return;
  const story = session.stories[session.index];
  const saved = session.labels[story.id];
  const recommendation = story.recommendation;
  const draft = session.draft;
  const changed =
    recommendation !== null &&
    (draft.kind !== recommendation.kind || (draft.kind !== "none" && draft.importance !== recommendation.importance));
  status.className = `status${draft.either ? "" : changed ? " changed" : saved ? " saved" : ""}`;
  status.replaceChildren();
  const line = draft.either
    ? "Either is fine. Enter saves it, with no reason needed."
    : !recommendation
      ? "No recommendation for this story. Pick a kind and an importance, then Enter."
      : changed
        ? "You changed the recommendation. Enter asks for a short reason."
        : "Matches the recommendation. Enter confirms.";
  status.append(el("div", "", saved ? `Saved as ${STATE_WORDS[saved.state]}. ${line}` : line));
  if (session.message) status.append(el("div", "message", session.message));
  const box = el("div", `reason${session.askingReason || draft.reason ? " open" : ""}`);
  box.append(reason, el("small", "", "Enter saves. Esc goes back to the keys."));
  status.append(box);
}

function draw() {
  const total = session.stories.length;
  const done = total - remaining(session);
  progress.replaceChildren(el("div", "", `${done} of ${total} labeled · ${total - done} left`));
  const bar = el("div", "bar");
  const fill = el("span");
  fill.style.width = `${(100 * done) / Math.max(total, 1)}%`;
  bar.append(fill);
  progress.append(bar);
  app.replaceChildren();
  status = null;

  if (session.index >= total) {
    const end = el("div", "done");
    end.append(
      el("h1", "", remaining(session) === 0 ? "Batch done." : `${remaining(session)} stories still have no label.`),
      el("p", "", "Export the labels and send the file. ← goes back to change a label."),
    );
    const button = el("button", "", "Export labels");
    button.addEventListener("click", download);
    end.append(button);
    app.append(end);
    return;
  }

  const story = data.stories[session.index];
  const draft = session.draft;
  const recommendation = story.recommendation;
  app.append(el("div", "source", `${story.source} · story ${session.index + 1} of ${total}`));
  const headline = el("h1");
  if (story.url) {
    const link = el("a", "", story.headline) as HTMLAnchorElement;
    link.href = story.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    headline.append(link);
  } else {
    headline.textContent = story.headline;
  }
  app.append(headline, el("p", "summary", story.summary));

  const kinds = el("div", "row");
  kinds.append(el("span", "name", "Kind"));
  for (const kind of KINDS) {
    const classes = [];
    if (draft.kind === kind.kind) classes.push("on");
    if (draft.also === kind.kind) classes.push("also");
    if (recommendation?.kind === kind.kind) classes.push("rec");
    kinds.append(chip(kind.key, kind.label, classes));
  }
  app.append(kinds);

  if (draft.kind !== "none") {
    const levels = el("div", "row");
    levels.append(el("span", "name", "Importance"));
    for (let level = 1; level <= 5; level++) {
      const classes = [];
      if (draft.importance === level) classes.push("on");
      if (recommendation?.importance === level) classes.push("rec");
      levels.append(chip(String(level), "", classes));
    }
    app.append(levels);
    app.append(el("div", "level", draft.importance ? (data.levels[draft.importance - 1]?.description ?? "") : ""));
  }
  if (draft.also) app.append(el("div", "level", `Also fits: ${KINDS.find((kind) => kind.kind === draft.also)?.label}`));

  status = el("div");
  app.append(status);
  if (reason.value !== draft.reason) reason.value = draft.reason;
  drawStatus();
}

function download() {
  const file = exportLabels(session, { batch: data.batch, scoringVersion: data.scoringVersion }, new Date().toISOString());
  const blob = new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `section-labels-${data.batch}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function after() {
  localStorage.setItem(storageKey, JSON.stringify({ index: session.index, labels: session.labels } satisfies SavedSession));
  draw();
  if (session.askingReason) reason.focus();
  else reason.blur();
}

const HANDLED = new Set(["Enter", "Escape", "ArrowLeft", "ArrowRight", "Backspace", "/", "e", "g", "r", "t", "n", "G", "R", "T", "1", "2", "3", "4", "5"]);

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (session.askingReason || document.activeElement === reason) {
    if (event.key !== "Enter" && event.key !== "Escape") return;
  } else if (event.key === "o") {
    const url = data.stories[session.index]?.url;
    if (url) window.open(url, "_blank", "noopener");
    return;
  } else if (!HANDLED.has(event.key)) {
    return;
  }
  event.preventDefault();
  session = press(session, event.key, new Date().toISOString());
  after();
});

document.getElementById("export")!.addEventListener("click", download);

const keys = document.getElementById("keys")!;
keys.innerHTML =
  "<kbd>Enter</kbd> confirm / save · <kbd>g</kbd> <kbd>r</kbd> <kbd>t</kbd> <kbd>n</kbd> kind · <kbd>Shift</kbd>+<kbd>G</kbd> <kbd>R</kbd> <kbd>T</kbd> also fits · <kbd>1</kbd>–<kbd>5</kbd> importance · <kbd>e</kbd> either is fine · <kbd>/</kbd> note · <kbd>o</kbd> open link · <kbd>←</kbd> back · <kbd>→</kbd> forward";

draw();
