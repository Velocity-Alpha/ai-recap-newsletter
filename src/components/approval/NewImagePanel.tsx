"use client";

import { useReducer, useState } from "react";
import Image from "next/image";
import { ImageIcon, Loader2, X } from "lucide-react";

import { isRefusal } from "@/src/features/newsletter/draft-links";
import { chooseImage, initialNewImageState, newImageReducer, type NewImageState } from "@/src/features/newsletter/draft-view-state";
import { requestImage, requestSceneIdeas } from "@/src/features/newsletter/new-image-client";
import type { DraftBoardView } from "@/src/pipeline/draft/draft-board";
import type { FeaturedImage } from "@/src/pipeline/draft/image/featured-image";
import type { SceneIdea } from "@/src/pipeline/draft/image/scene-ideas";

/**
 * "New image" on the current draft (#116, #149): the current image and scene prompt, three scene ideas, "Generate"
 * as often as needed, then "Use this image", which puts the image into the same draft (ADR 0004).
 */

export type IdeasState = { status: "loading" } | { status: "ready"; ideas: SceneIdea[] } | { status: "error"; error: string };

export type NewImagePanelProps = {
  currentImageUrl: string | null;
  scene: string;
  ideas: IdeasState;
  generated: FeaturedImage | null;
  busy: NewImageState["busy"];
  error: string | null;
  onSceneChange: (scene: string) => void;
  onRetryIdeas: () => void;
  onGenerate: () => void;
  onChoose: () => void;
  onClose: () => void;
};

const LABEL = "text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]";
const FRAME = "overflow-hidden rounded-xl border border-[var(--border-light)] bg-white";
const DARK_BUTTON =
  "rounded-full bg-[var(--text-primary)] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--watercolor-ink)] disabled:cursor-not-allowed disabled:opacity-60";
const LIGHT_BUTTON =
  "rounded-full border border-[var(--border-light)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-60";

function Picture({ src, alt }: { src: string; alt: string }) {
  // `unoptimized`: the owner checks the exact file the email will use.
  return <Image src={src} alt={alt} width={1280} height={720} unoptimized className="h-auto w-full" />;
}

function Ideas({ ideas, disabled, onPick, onRetry }: { ideas: IdeasState; disabled: boolean; onPick: (scene: string) => void; onRetry: () => void }) {
  if (ideas.status === "loading") {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Suggesting scene ideas…
      </p>
    );
  }
  if (ideas.status === "error") {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--accent-warm)]">
        <span>{ideas.error}</span>
        <button type="button" className={LIGHT_BUTTON} onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {ideas.ideas.map((idea, index) => (
        <button key={index} type="button" data-idea={index} className={LIGHT_BUTTON} title={idea.scene} disabled={disabled} onClick={() => onPick(idea.scene)}>
          {idea.label}
        </button>
      ))}
    </div>
  );
}

export function NewImagePanel(props: NewImagePanelProps) {
  const { currentImageUrl, scene, ideas, generated, busy, error } = props;
  const working = busy !== null;

  return (
    <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-main)] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-primary)]">New image</p>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-60"
          onClick={props.onClose}
          disabled={busy === "choose"}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Close
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <figure className="space-y-2">
          <figcaption className={LABEL}>Now</figcaption>
          {currentImageUrl ? (
            <div className={FRAME}>
              <Picture src={currentImageUrl} alt="The featured image the draft has now" />
            </div>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">This draft has no image.</p>
          )}
        </figure>
        <figure className="space-y-2">
          <figcaption className={LABEL}>New</figcaption>
          {generated ? (
            <>
              <div className={FRAME}>
                <Picture src={generated.imageUrl} alt="The new featured image" />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={DARK_BUTTON} onClick={props.onChoose} disabled={working}>
                  {busy === "choose" ? "Saving…" : "Use this image"}
                </button>
                <span className="text-xs text-[var(--text-secondary)]">Puts this image into the draft. The text stays the same.</span>
              </div>
            </>
          ) : (
            <div className={`${FRAME} flex aspect-video flex-col items-center justify-center gap-2 bg-transparent text-sm text-[var(--text-muted)]`}>
              {busy === "generate" ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <ImageIcon className="h-5 w-5" aria-hidden />}
              {busy === "generate" ? "Making the image. This can take a minute." : "Generate an image to see it here."}
            </div>
          )}
        </figure>
      </div>

      <label className={`mt-5 block ${LABEL}`} htmlFor="new-image-scene">
        Scene prompt
      </label>
      <textarea
        id="new-image-scene"
        rows={6}
        className="mt-2 w-full rounded-xl border border-[var(--border-light)] bg-white px-3 py-2 text-sm leading-relaxed text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
        value={scene}
        onChange={(event) => props.onSceneChange(event.target.value)}
        disabled={working}
      />
      <p className="mt-1 text-xs text-[var(--text-muted)]">The fixed watercolor style is added to this. Describe only the scene.</p>

      <p className={`mt-4 ${LABEL}`}>Ideas</p>
      <div className="mt-2">
        <Ideas ideas={ideas} disabled={working} onPick={props.onSceneChange} onRetry={props.onRetryIdeas} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" className={DARK_BUTTON} onClick={props.onGenerate} disabled={working || !scene.trim()}>
          {busy === "generate" ? "Generating…" : generated ? "Generate again" : "Generate"}
        </button>
        <span className="text-xs text-[var(--text-secondary)]">Edit the scene and generate again.</span>
      </div>

      {error ? (
        <p className="mt-4 whitespace-pre-wrap break-words rounded-xl border border-[rgba(184,133,110,0.28)] bg-[rgba(255,244,236,0.92)] px-4 py-3 text-sm text-[var(--accent-warm)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

/**
 * The "New image" button, and its panel once opened. Ideas load when the panel first opens. Its state is in
 * draft-view-state.ts. `onChanged` runs after "Use this image", and after a refusal, so the page reads the draft
 * again.
 */
export default function NewImage({ draft, onChanged }: { draft: DraftBoardView; onChanged?: () => void }) {
  const [state, dispatch] = useReducer(newImageReducer, draft.scenePrompt, initialNewImageState);
  const [ideas, setIdeas] = useState<IdeasState | null>(null);
  const { generated } = state;

  async function loadIdeas() {
    setIdeas({ status: "loading" });
    try {
      setIdeas({ status: "ready", ideas: await requestSceneIdeas(draft.id) });
    } catch (reason) {
      setIdeas({ status: "error", error: messageOf(reason) });
    }
  }

  function openPanel() {
    dispatch({ type: "opened" });
    if (ideas?.status !== "ready") void loadIdeas();
  }

  async function generate() {
    dispatch({ type: "generating" });
    try {
      dispatch({ type: "generated", image: await requestImage(draft.id, state.scene) });
    } catch (reason) {
      dispatch({ type: "failed", error: messageOf(reason) });
      if (isRefusal(reason)) onChanged?.();
    }
  }

  if (!state.open) {
    return (
      <button type="button" className={`inline-flex items-center gap-1.5 ${LIGHT_BUTTON}`} onClick={openPanel}>
        <ImageIcon className="h-3.5 w-3.5" aria-hidden />
        New image
      </button>
    );
  }

  return (
    <div className="basis-full">
      <NewImagePanel
        currentImageUrl={draft.featuredImageUrl}
        scene={state.scene}
        ideas={ideas ?? { status: "loading" }}
        generated={generated}
        busy={state.busy}
        error={state.error}
        onSceneChange={(scene) => dispatch({ type: "scene_changed", scene })}
        onRetryIdeas={() => void loadIdeas()}
        onGenerate={() => void generate()}
        onChoose={() => {
          if (generated) void chooseImage(draft.id, generated, { dispatch, onChanged });
        }}
        onClose={() => dispatch({ type: "closed" })}
      />
    </div>
  );
}
