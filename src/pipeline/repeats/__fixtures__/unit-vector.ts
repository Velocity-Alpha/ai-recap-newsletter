/** For tests: a unit vector at `degrees` from [1, 0]. Its similarity to [1, 0] is cos(degrees). */
export function unitVector(degrees: number): number[] {
  const radians = (degrees * Math.PI) / 180;
  return [Math.cos(radians), Math.sin(radians)];
}
