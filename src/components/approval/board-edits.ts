type StoryRef = { id: number };

type BuiltSection = { key: string; selected: StoryRef[]; fill_ins: StoryRef[] };

type BoardSection = { key: string; stories: { story: StoryRef; status: "selected" | "fill-in" }[] };

function builtLayout(sections: BuiltSection[]): string {
  return sections
    .map((section) => {
      const stories = [
        ...section.selected.map((story) => `${story.id}s`),
        ...section.fill_ins.map((story) => `${story.id}f`),
      ];
      return `${section.key}:${stories.join(",")}`;
    })
    .join("|");
}

function boardLayout(sections: BoardSection[]): string {
  return sections
    .map((section) => {
      const stories = section.stories.map(
        (slot) => `${slot.story.id}${slot.status === "selected" ? "s" : "f"}`
      );
      return `${section.key}:${stories.join(",")}`;
    })
    .join("|");
}

/** True once the owner has changed anything on the board since it loaded the built sections. */
export function hasBoardEdits(board: {
  candidateSections: BuiltSection[];
  sections: BoardSection[];
  headlineStoryId: number | null;
  excludeState: Record<number, unknown>;
  urlOverrides: Record<number, string>;
  notesOverrides: Record<number, string>;
}): boolean {
  return (
    board.headlineStoryId !== null ||
    Object.keys(board.excludeState).length > 0 ||
    Object.keys(board.urlOverrides).length > 0 ||
    Object.keys(board.notesOverrides).length > 0 ||
    boardLayout(board.sections) !== builtLayout(board.candidateSections)
  );
}
