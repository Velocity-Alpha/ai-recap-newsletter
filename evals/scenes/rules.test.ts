import { describe, expect, it } from "vitest";

import { checkSceneText, INTERPRETIVE_SCENE_IDEAS } from "@/evals/scenes/rules";

const GOOD =
  "In the foreground a brass key rests on a table; the midground holds a door; the background fades to white. " +
  "Eye-level camera at medium distance. Soft morning light falls from the left.";

describe("checkSceneText", () => {
  it("passes a scene with its three layers, a camera angle and distance, and lighting", () => {
    expect(checkSceneText(GOOD)).toMatchObject({ layers: true, camera: true, lighting: true, interpretiveWords: [], styleWords: [] });
  });

  it("counts the scene's words", () => {
    expect(checkSceneText("One two three.").words).toBe(3);
  });

  it("flags a missing layer", () => {
    expect(checkSceneText("Foreground and background only, eye-level camera, close, soft light.").layers).toBe(false);
  });

  it("accepts 'middle ground' for the midground", () => {
    expect(checkSceneText("Foreground, middle ground, background.").layers).toBe(true);
  });

  it("finds interpretive words in their forms", () => {
    expect(checkSceneText(`${GOOD} The door symbolizes hope, a theme.`).interpretiveWords).toEqual(["symbolizes", "theme"]);
  });

  it("does not flag a word that only contains a forbidden one", () => {
    expect(checkSceneText(`${GOOD} Workers implement the theater lights.`).interpretiveWords).toEqual([]);
  });

  it("finds style words", () => {
    expect(checkSceneText(`${GOOD} Painted in watercolor.`).styleWords).toEqual(["watercolor"]);
  });

  it("finds the forms of a forbidden word", () => {
    const text = `${GOOD} It symbolises, implied, representing, a watercolour, metaphors, in negative space.`;
    expect(checkSceneText(text)).toMatchObject({
      interpretiveWords: ["representing", "symbolises", "implied", "metaphors"],
      styleWords: ["watercolour", "negative space"],
    });
  });

  it("checks the interpretive words of the list it is given", () => {
    // "implies" is on the scene prompt's list only.
    expect(checkSceneText(`${GOOD} It implies trust.`).interpretiveWords).toEqual(["implies"]);
    expect(checkSceneText(`${GOOD} It implies trust.`, INTERPRETIVE_SCENE_IDEAS).interpretiveWords).toEqual([]);
  });
});
