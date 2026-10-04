// Krine's block catalog for the Golden Sachs-style branch picker.
import type { Branch, Condition, Metric, Policy, Reference, Rule } from '../types';
import { defaultValue, newCondition } from '../policy';
import { challenges, ports, type Port, setBranch } from '../workflow';

export type IconName =
  | 'request'
  | 'condition'
  | 'automation'
  | 'velocity'
  | 'identity'
  | 'network'
  | 'clock'
  | 'input'
  | 'verify'
  | 'allow'
  | 'deny';
export interface Block {
  id: string;
  title: string;
  description: string;
  group: string;
  icon: IconName;
  condition?: Condition;
  action?: Branch;
  through?: 'then' | 'on_false';
}
const labels: Record<string, [string, IconName]> = {
  'browser.automation_observed': ['Browser automation', 'automation'],
  'session.event_count_5m': ['Session velocity', 'velocity'],
  'ip.event_count_5m': ['IP velocity', 'velocity'],
  'client.user_count_30d': ['Account relationships', 'identity'],
  'client.multi_account': ['Multiple accounts', 'identity'],
  'ip.risk': ['IP risk', 'network'],
  'ip.high_risk': ['High-risk IP', 'network'],
  'ip.is_proxy': ['Proxy connection', 'network'],
  'ip.country': ['Country', 'network'],
  'client.age_seconds': ['Client age', 'clock'],
  'session.age_seconds': ['Session age', 'clock'],
};
export function conditionIdentity(c: Condition): { title: string; icon: IconName } {
  if (c.op === 'not') return { title: 'Negated condition', icon: 'condition' };
  if (c.op === 'all' || c.op === 'any')
    return { title: c.op === 'all' ? 'All conditions' : 'Any condition', icon: 'condition' };
  const ref = c.op === 'known' ? c.value : c.left;
  const label = ref.source === 'metric' ? labels[ref.name] : undefined;
  return {
    title: label?.[0] ?? (ref.source === 'input' ? 'Backend input' : 'Condition'),
    icon: label?.[1] ?? (ref.source === 'input' ? 'input' : 'condition'),
  };
}
export function blockCatalog(policy: Policy, metrics: Metric[]): Block[] {
  return [
    ...metrics.map((m): Block => {
      const [title, icon] = labels[m.name] ?? [m.name, 'condition'];
      const value =
        m.value_type === 'boolean'
          ? true
          : m.value_type === 'string'
            ? 'PL'
            : m.name === 'ip.risk'
              ? 0.8
              : m.name.includes('event_count')
                ? 20
                : m.name.includes('user_count')
                  ? 3
                  : 10;
      return {
        id: m.name,
        title,
        icon,
        description: m.description,
        group: 'Evidence checks',
        through: 'on_false',
        condition: {
          op: 'compare',
          left: { source: 'metric', name: m.name, version: m.version },
          comparison:
            m.value_type === 'number' ? (m.name.includes('age_seconds') ? 'lt' : 'gte') : 'eq',
          value,
        },
      };
    }),
    ...Object.entries(policy.inputs).map(
      ([name, type]): Block => ({
        id: `input:${name}`,
        title: name,
        icon: 'input',
        description: `Compare the trusted ${type} supplied by your backend.`,
        group: 'Backend inputs',
        through: 'then',
        condition: {
          op: 'compare',
          left: { source: 'input', name },
          comparison: 'eq',
          value: type === 'boolean' ? true : defaultValue(type),
        },
      }),
    ),
    ...(metrics.length
      ? [
          {
            id: 'custom',
            title: 'Custom condition',
            description: 'Combine evidence with All, Any, Not, ranges or membership.',
            group: 'Logic',
            icon: 'condition',
            through: 'then',
            condition: newCondition(metrics),
          } as Block,
        ]
      : []),
    {
      id: 'verify',
      title: 'Require verification',
      description: 'Verify this operation, then follow its success connection. Failure denies.',
      group: 'Outcomes',
      icon: 'verify',
      action: 'CHALLENGE',
    },
    {
      id: 'deny',
      title: 'Deny action',
      description: 'End this path with a denial.',
      group: 'Outcomes',
      icon: 'deny',
      action: 'DENY',
    },
    {
      id: 'allow',
      title: 'Allow action',
      description: 'End this path with an explicit allow.',
      group: 'Outcomes',
      icon: 'allow',
      action: 'ALLOW',
    },
  ];
}
export interface Insertion {
  source: string;
  port: Port | 'entry';
}
export function branchAt(policy: Policy, point: Insertion): Branch | undefined {
  const branch =
    point.source === '$entry'
      ? policy.entry
      : policy.rules.find((r) => r.id === point.source)?.[point.port as Port];
  return branch === 'NEXT' ? undefined : branch;
}
export function connectBranch(policy: Policy, point: Insertion, branch: Branch): Policy {
  return point.source === '$entry'
    ? { ...policy, entry: branch }
    : setBranch(policy, point.source, point.port as Port, branch);
}
export function insertBlock(policy: Policy, point: Insertion, block: Block, id: string): Policy {
  if (block.action) return connectBranch(policy, point, block.action);
  if (!block.condition) return policy;
  const previous = branchAt(policy, point) ?? 'DENY';
  const rule: Rule = {
    id,
    condition: structuredClone(block.condition),
    then: 'DENY',
    on_false: 'DENY',
    on_unknown: 'DENY',
    [block.through ?? 'then']: previous,
  };
  if (previous === 'CHALLENGE')
    rule.on_verified = policy.rules.find((r) => r.id === point.source)?.on_verified ?? 'DENY';
  const arranged = arrangeSteps(policy);
  const current = policy.rules.map((r, i) => ({
    ...r,
    position: r.position ?? arranged.rules[i]!.position!,
  }));
  const owner = current.find((r) => r.id === point.source)?.position ?? { x: 0, y: 100 };
  const source =
    point.port === 'on_verified'
      ? (verificationPositions(current).get(point.source) ?? verificationPosition(owner))
      : owner;
  const desired = { x: source.x + 340, y: source.y };

  // Make room only in the continuation being split, never in unrelated branches.
  const downstream = new Set<string>();
  function visit(branch: Branch | 'NEXT' | undefined) {
    if (typeof branch !== 'object' || downstream.has(branch.goto)) return;
    downstream.add(branch.goto);
    const step = current.find((r) => r.id === branch.goto);
    if (step) for (const port of ports) visit(step[port]);
  }
  visit(previous);
  const target =
    typeof previous === 'object' ? current.find((r) => r.id === previous.goto) : undefined;
  const shift = target ? Math.max(0, desired.x + 340 - target.position.x) : 0;
  let shifted = current.map((r) =>
    downstream.has(r.id) ? { ...r, position: { ...r.position, x: r.position.x + shift } } : r,
  );
  const unaffected = current.filter((r) => !downstream.has(r.id)).flatMap(occupiedPositions);
  // If that continuation cannot move safely, use a free lane for the new step.
  if (
    shifted.some(
      (r) =>
        Math.abs(r.position.x) > 10000 ||
        (downstream.has(r.id) &&
          occupiedPositions(r).some((p) => unaffected.some((other) => overlaps(p, other)))),
    )
  )
    shifted = current;
  const connected = connectBranch({ ...policy, rules: shifted }, point, { goto: id });
  const occupied = [
    { x: 0, y: 100 },
    ...connected.rules.flatMap((r) => (r.position ? [r.position] : [])),
    ...verificationPositions(connected.rules).values(),
  ];
  const position = freePosition(desired, occupied, challenges(rule));
  return { ...connected, rules: [...connected.rules, { ...rule, position }] };
}
type Point = { x: number; y: number };
export const verificationPosition = (owner: Point): Point => ({
  x: owner.x + 340,
  y: owner.y + 220,
});
export function verificationPositions(rules: Rule[]): Map<string, Point> {
  const occupied = rules.flatMap((r) => (r.position ? [r.position] : []));
  const positions = new Map<string, Point>();
  for (const rule of rules) {
    if (!rule.position || !challenges(rule)) continue;
    const position = freePosition(verificationPosition(rule.position), occupied, false);
    positions.set(rule.id, position);
    occupied.push(position);
  }
  return positions;
}
function occupiedPositions(rule: Rule): Point[] {
  return rule.position
    ? [rule.position, ...(challenges(rule) ? [verificationPosition(rule.position)] : [])]
    : [];
}
function overlaps(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 280 && Math.abs(a.y - b.y) < 260;
}
function freePosition(preferred: Point, occupied: Point[], verification: boolean): Point {
  const x = Math.min(10000, preferred.x);
  // Search adjacent lanes in stable order. Existing positions are never rewritten.
  for (let lane = 0; lane <= 128; lane++) {
    const y = preferred.y + (lane % 2 ? (lane + 1) / 2 : -lane / 2) * 330;
    if (Math.abs(y) > 10000) continue;
    const point = { x, y };
    const candidates = [point, ...(verification ? [verificationPosition(point)] : [])];
    if (candidates.every((p) => occupied.every((other) => !overlaps(p, other)))) return point;
  }
  // The bounded 32-step graph cannot occupy all the lanes searched above.
  throw new Error('No free workflow lane.');
}
// Adapted from Golden Sachs' longest-path arrange: joins stay after every predecessor.
export function arrangeSteps(policy: Policy): Policy {
  const depths = new Map(policy.rules.map((r) => [r.id, 1]));
  for (let pass = 0; pass < policy.rules.length; pass++) {
    let changed = false;
    for (const r of policy.rules)
      for (const port of ports) {
        const b = r[port];
        if (typeof b !== 'object') continue;
        const depth = (depths.get(r.id) ?? 1) + (port === 'on_verified' ? 2 : 1);
        if (depth > (depths.get(b.goto) ?? 1)) {
          depths.set(b.goto, depth);
          changed = true;
        }
      }
    if (!changed) break;
  }
  const spacing = Math.min(340, 9600 / Math.max(1, ...depths.values()));
  const rows = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const r of [...policy.rules].sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))) {
    const depth = depths.get(r.id) ?? 1,
      row = rows.get(depth) ?? 0;
    positions.set(r.id, { x: depth * spacing, y: row * 330 + 80 });
    rows.set(depth, row + 1);
  }
  return { ...policy, rules: policy.rules.map((r) => ({ ...r, position: positions.get(r.id)! })) };
}
export function references(condition: Condition): Reference[] {
  if (condition.op === 'not') return references(condition.condition);
  if (condition.op === 'all' || condition.op === 'any')
    return condition.conditions.flatMap(references);
  return [condition.op === 'known' ? condition.value : condition.left];
}
export function policyForConnection(
  policy: Policy,
  source: string,
  port: string | null | undefined,
  target: string,
): Policy | null {
  if (
    !port ||
    source === target ||
    target === '$entry' ||
    source === '$allow' ||
    source === '$deny' ||
    port === 'failure'
  )
    return null;
  const owner = source.startsWith('$verify:') ? source.slice(8) : source;
  let branch: Branch;
  if (target === '$allow') branch = 'ALLOW';
  else if (target === '$deny') branch = 'DENY';
  else if (target.startsWith('$verify:')) {
    if (target.slice(8) !== owner || source.startsWith('$verify:')) return null;
    branch = 'CHALLENGE';
  } else branch = { goto: target };
  return connectBranch(
    policy,
    { source: owner, port: source === '$entry' ? 'entry' : (port as Port) },
    branch,
  );
}
export interface PreviewEvaluation {
  outcome: string;
  reason: string;
  rule_id: string | null;
  trace: { rule_id: string; route: string; condition: { result: 'true' | 'false' | 'unknown' } }[];
}
export function previewPath(run: PreviewEvaluation): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set(['$entry']),
    edges = new Set(['$entry:entry']);
  for (const step of run.trace) {
    nodes.add(step.rule_id);
    const port =
      step.condition.result === 'true'
        ? 'then'
        : step.condition.result === 'false'
          ? 'on_false'
          : 'on_unknown';
    edges.add(`${step.rule_id}:${port}`);
    if (step.route.startsWith('verification_') || step.route === 'challenge') {
      nodes.add(`$verify:${step.rule_id}`);
      if (step.route === 'verification_passed') edges.add(`$verify:${step.rule_id}:on_verified`);
      else if (step.route !== 'challenge') edges.add(`$verify:${step.rule_id}:failure`);
    }
  }
  if (run.outcome === 'ALLOW') nodes.add('$allow');
  if (run.outcome === 'DENY') nodes.add('$deny');
  return { nodes, edges };
}
