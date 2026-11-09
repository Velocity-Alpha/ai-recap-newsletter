/** The context Next.js passes to a route under `[id]`. */
export type IdRouteContext = { params: Promise<{ id: string }> };

/** The `[id]` segment as a positive whole number, else null. */
export async function positiveIdParam(context: IdRouteContext): Promise<number | null> {
  const { id } = await context.params;
  const value = Number(id);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
