/**
 * A closed box as OBJ text, for tests that need a shell of a stated size rather
 * than a model. Corners are shared by index and every facet is wound outward, so
 * the readers report a watertight envelope instead of an open-boundary artifact.
 */
export function boxMeshObj(widthMm: number, depthMm: number, heightMm: number): string {
  const halfX = widthMm / 2;
  const halfY = heightMm / 2;
  const halfZ = depthMm / 2;
  const corners: Array<[number, number, number]> = [
    [-halfX, -halfY, -halfZ], [halfX, -halfY, -halfZ], [halfX, halfY, -halfZ], [-halfX, halfY, -halfZ],
    [-halfX, -halfY, halfZ], [halfX, -halfY, halfZ], [halfX, halfY, halfZ], [-halfX, halfY, halfZ],
  ];
  const triangles: Array<[number, number, number]> = [
    [1, 3, 2], [1, 4, 3],
    [5, 6, 7], [5, 7, 8],
    [1, 2, 6], [1, 6, 5],
    [3, 4, 8], [3, 8, 7],
    [1, 5, 8], [1, 8, 4],
    [2, 3, 7], [2, 7, 6],
  ];
  return [
    ...corners.map(([x, y, z]) => `v ${x} ${y} ${z}`),
    ...triangles.map(([i, j, k]) => `f ${i} ${j} ${k}`),
  ].join('\n');
}
