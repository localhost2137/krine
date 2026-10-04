import { describe, expect, it } from 'vitest';
import {
  arrangeSteps,
  insertBlock,
  previewPath,
  verificationPosition,
  verificationPositions,
  type Block,
} from './blocks';
import { workflowError } from '../workflow';
import type { Policy, Rule } from '../types';
const condition = { op: 'known', value: { source: 'input', name: 'approved' } } as const;
const policy: Policy = {
  schema_version: 2,
  entry: { goto: 'a' },
  inputs: { approved: 'boolean' },
  otherwise: 'DENY',
  rules: [
    {
      id: 'a',
      condition,
      then: 'ALLOW',
      on_false: 'DENY',
      on_unknown: 'CHALLENGE',
      on_verified: 'ALLOW',
    },
  ],
};
const plain: Rule = { id: 'a', condition, then: 'ALLOW', on_false: 'DENY', on_unknown: 'DENY' };
const block: Block = {
  id: 'condition',
  title: 'Condition',
  description: '',
  icon: 'condition',
  group: 'Logic',
  condition,
  through: 'then',
};
describe('graph editing', () => {
  it('preserves manual positions and makes room for an inserted step', () => {
    const moved: Policy = {
      ...policy,
      rules: [
        { ...plain, position: { x: 460, y: 210 }, then: { goto: 'c' } },
        { ...policy.rules[0]!, id: 'c', position: { x: 800, y: 350 } },
      ],
    };
    const next = insertBlock(moved, { source: 'a', port: 'then' }, block, 'b');
    expect(next.rules[0]!.position).toEqual({ x: 460, y: 210 });
    expect(next.rules[1]!.position).toEqual({ x: 1140, y: 350 });
    expect(next.rules[2]!.position).toEqual({ x: 800, y: 210 });
    expect(next.rules[2]!.then).toEqual({ goto: 'c' });
  });
  it('leaves unrelated branches exactly where the user placed them', () => {
    const base = plain;
    const fork: Policy = {
      ...policy,
      rules: [
        { ...base, position: { x: 340, y: 80 }, then: { goto: 'b' }, on_false: { goto: 'other' } },
        { ...base, id: 'b', position: { x: 680, y: 80 } },
        { ...base, id: 'other', position: { x: 1100, y: 740 } },
      ],
    };
    const next = insertBlock(fork, { source: 'a', port: 'then' }, block, 'inserted');
    expect(next.rules.find((r) => r.id === 'other')!.position).toEqual({ x: 1100, y: 740 });
    expect(next.rules.find((r) => r.id === 'b')!.position).toEqual({ x: 1020, y: 80 });
    expect(next.rules.find((r) => r.id === 'inserted')!.position).toEqual({ x: 680, y: 80 });
  });
  it('places a new branch in a free lane without moving its sibling', () => {
    const base = plain;
    const fork: Policy = {
      ...policy,
      rules: [
        { ...base, position: { x: 340, y: 80 }, then: { goto: 'b' } },
        { ...base, id: 'b', position: { x: 680, y: 80 } },
      ],
    };
    const next = insertBlock(fork, { source: 'a', port: 'on_false' }, block, 'new_branch');
    expect(next.rules[1]!.position).toEqual({ x: 680, y: 80 });
    expect(next.rules[2]!.position).toEqual({ x: 680, y: 410 });
  });
  it('positions a verification continuation relative to the verification node', () => {
    const next = insertBlock(
      policy,
      { source: 'a', port: 'on_verified' },
      block,
      'after_verification',
    );
    const owner = next.rules[0]!.position!;
    const verification = verificationPosition(owner);
    expect(next.rules[1]!.position).toEqual({ x: verification.x + 340, y: verification.y });
    expect(workflowError(next)).toBeNull();
  });
  it('uses a free lane instead of pushing a continuation into an unrelated node', () => {
    const base = plain;
    const fork: Policy = {
      ...policy,
      rules: [
        { ...base, position: { x: 340, y: 80 }, then: { goto: 'b' } },
        { ...base, id: 'b', position: { x: 680, y: 80 } },
        { ...base, id: 'other', position: { x: 1020, y: 80 } },
      ],
    };
    const next = insertBlock(fork, { source: 'a', port: 'then' }, block, 'new_branch');
    expect(next.rules.slice(0, 3).map((r) => r.position)).toEqual(
      fork.rules.map((r) => r.position),
    );
    expect(next.rules[3]!.position).toEqual({ x: 680, y: 410 });
  });
  it('preserves user positions at the canvas boundary without rearranging the graph', () => {
    const bounded: Policy = { ...policy, rules: [{ ...plain, position: { x: 9980, y: 9980 } }] };
    const next = insertBlock(bounded, { source: 'a', port: 'then' }, block, 'b');
    expect(next.rules[0]!.position).toEqual({ x: 9980, y: 9980 });
    expect(workflowError(next)).toBeNull();
    expect(next.rules[1]!.position).toEqual({ x: 10000, y: 9650 });
  });
  it('keeps verification clear of existing steps and inserts after its actual location', () => {
    const graph: Policy = {
      ...policy,
      rules: [
        { ...policy.rules[0]!, position: { x: 340, y: 80 } },
        { ...plain, id: 'other', position: { x: 680, y: 300 } },
      ],
    };
    const verification = verificationPositions(graph.rules).get('a')!;
    expect(verification).toEqual({ x: 680, y: 630 });
    const next = insertBlock(graph, { source: 'a', port: 'on_verified' }, block, 'continued');
    expect(next.rules[2]!.position).toEqual({ x: 1020, y: 630 });
    expect(next.rules[1]!.position).toEqual({ x: 680, y: 300 });
  });
  it('inserts before an existing verification without losing its success destination', () => {
    const next = insertBlock(policy, { source: 'a', port: 'on_unknown' }, block, 'b');
    expect(workflowError(next)).toBeNull();
    expect(next.rules[0]!.on_unknown).toEqual({ goto: 'b' });
    expect(next.rules[0]!.on_verified).toBeUndefined();
    expect(next.rules[1]!.then).toBe('CHALLENGE');
    expect(next.rules[1]!.on_verified).toBe('ALLOW');
  });
  it('keeps arrangement within persisted coordinate bounds for maximum-length workflows', () => {
    const long: Policy = {
      ...policy,
      rules: Array.from({ length: 32 }, (_, i) => ({
        id: `s${i}`,
        condition,
        then: i === 31 ? 'ALLOW' : { goto: `s${i + 1}` },
        on_false: 'DENY',
        on_unknown: 'DENY',
      })),
      entry: { goto: 's0' },
    };
    const arranged = arrangeSteps(long);
    expect(workflowError(arranged)).toBeNull();
    expect(
      arranged.rules.every((r, i) => !i || r.position!.x > arranged.rules[i - 1]!.position!.x),
    ).toBe(true);
  });
  it('highlights the condition branch and verification continuation independently', () => {
    const path = previewPath({
      outcome: 'ALLOW',
      reason: 'workflow_branch',
      rule_id: 'a',
      trace: [{ rule_id: 'a', route: 'verification_passed', condition: { result: 'unknown' } }],
    });
    expect([...path.edges]).toEqual(['$entry:entry', 'a:on_unknown', '$verify:a:on_verified']);
    expect(path.nodes.has('$allow')).toBe(true);
    expect(path.nodes.has('$deny')).toBe(false);
  });
});
