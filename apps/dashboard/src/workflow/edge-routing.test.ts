import { describe, expect, it } from 'vitest';
import { routeEdge, type Obstacle } from './edge-routing';
function assertClear(boxes: Obstacle[], source = { x: 240, y: 90 }, target = { x: 1020, y: 120 }) {
  const path = routeEdge(source, target, boxes);
  expect(path[0]).toEqual(source);
  expect(path.at(-1)).toEqual(target);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!,
      b = path[i]!;
    expect(a.x === b.x || a.y === b.y).toBe(true);
    for (const r of boxes) {
      const intersects =
        a.x === b.x
          ? a.x > r.x &&
            a.x < r.x + r.width &&
            Math.max(a.y, b.y) > r.y &&
            Math.min(a.y, b.y) < r.y + r.height
          : a.y > r.y &&
            a.y < r.y + r.height &&
            Math.max(a.x, b.x) > r.x &&
            Math.min(a.x, b.x) < r.x + r.width;
      expect(intersects, JSON.stringify({ a, b, r })).toBe(false);
    }
  }
}
describe('workflow routing', () => {
  const ends = [
    { x: 0, y: 0, width: 240, height: 210 },
    { x: 1020, y: 80, width: 240, height: 100 },
  ];
  it('skips intervening condition cards', () =>
    assertClear([
      ...ends,
      { x: 340, y: 40, width: 240, height: 210 },
      { x: 680, y: 0, width: 240, height: 210 },
    ]));
  it('routes around a moved, taller card', () =>
    assertClear([...ends, { x: 460, y: -120, width: 300, height: 440 }]));
  it('supports a connection pointing back to an earlier column', () =>
    assertClear(ends, { x: 1260, y: 130 }, { x: 0, y: 100 }));
});
