export interface Point {
  x: number;
  y: number;
}
export interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Route between escaped handles on a visibility grid outside measured cards. */
export function routeEdge(source: Point, target: Point, obstacles: Obstacle[], lane = 0): Point[] {
  const gap = 16 + lane * 7;
  const boxes = obstacles.map((b) => ({
    left: b.x - 10,
    right: b.x + b.width + 10,
    top: b.y - 10,
    bottom: b.y + b.height + 10,
  }));
  const start = { x: source.x + gap, y: source.y };
  const end = { x: target.x - gap, y: target.y };
  const xs = [
    ...new Set([start.x, end.x, ...boxes.flatMap((b) => [b.left - gap, b.right + gap])]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([start.y, end.y, ...boxes.flatMap((b) => [b.top - gap, b.bottom + gap])]),
  ].sort((a, b) => a - b);
  const blocked = (a: Point, b: Point) =>
    boxes.some((r) =>
      a.x === b.x
        ? a.x > r.left &&
          a.x < r.right &&
          Math.max(a.y, b.y) > r.top &&
          Math.min(a.y, b.y) < r.bottom
        : a.y > r.top &&
          a.y < r.bottom &&
          Math.max(a.x, b.x) > r.left &&
          Math.min(a.x, b.x) < r.right,
    );
  const key = (x: number, y: number, dir: number) => `${x}:${y}:${dir}`;
  const initial = {
    x: xs.indexOf(start.x),
    y: ys.indexOf(start.y),
    dir: 0,
    cost: 0,
    key: '',
  };
  initial.key = key(initial.x, initial.y, 0);
  const queue = [initial];
  const costs = new Map([[initial.key, 0]]);
  const previous = new Map<string, string>();
  const points = new Map([[initial.key, start]]);
  while (queue.length) {
    queue.sort((a, b) => b.cost - a.cost);
    const current = queue.pop()!;
    if (current.cost !== costs.get(current.key)) continue;
    const a = { x: xs[current.x]!, y: ys[current.y]! };
    if (a.x === end.x && a.y === end.y) {
      const path: Point[] = [];
      let k: string | undefined = current.key;
      while (k) {
        path.push(points.get(k)!);
        k = previous.get(k);
      }
      const full = [source, ...path.reverse(), target];
      return full.filter(
        (p, i) =>
          i === 0 ||
          i === full.length - 1 ||
          !(
            (full[i - 1]!.x === p.x && p.x === full[i + 1]!.x) ||
            (full[i - 1]!.y === p.y && p.y === full[i + 1]!.y)
          ),
      );
    }
    for (const [dx, dy, dir] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 1],
      [0, -1, 1],
    ]) {
      const x = current.x + dx!,
        y = current.y + dy!;
      if (x < 0 || y < 0 || x >= xs.length || y >= ys.length) continue;
      const b = { x: xs[x]!, y: ys[y]! };
      if (blocked(a, b)) continue;
      const cost =
        current.cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (current.dir === dir ? 0 : 30);
      const k = key(x, y, dir!);
      if (cost >= (costs.get(k) ?? Infinity)) continue;
      costs.set(k, cost);
      previous.set(k, current.key);
      points.set(k, b);
      queue.push({ x, y, dir: dir!, cost, key: k });
    }
  }
  // Overlapping cards can trap a handle. Keep a visible, draggable connection.
  return [source, start, { x: start.x, y: end.y }, end, target];
}
export function edgePath(points: Point[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
}
