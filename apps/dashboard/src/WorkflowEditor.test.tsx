import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PolicyEditor, PolicyRead } from './PolicyEditor';
import type { Policy } from './types';
vi.mock('./PolicyFlow', () => ({ PolicyFlow: () => <div aria-label="Workflow canvas" /> }));
beforeAll(() => {
  HTMLDialogElement.prototype.show = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(cleanup);
const initial: Policy = {
  schema_version: 2,
  entry: 'DENY',
  inputs: { approved: 'boolean' },
  rules: [],
  otherwise: 'DENY',
};
function Harness() {
  const [policy, setPolicy] = useState(initial);
  return (
    <MemoryRouter>
      <PolicyEditor policy={policy} metrics={[]} onChange={setPolicy} />
      <output data-testid="policy">{JSON.stringify(policy)}</output>
    </MemoryRouter>
  );
}
const policy = () => JSON.parse(screen.getByTestId('policy').textContent!) as Policy;
describe('workflow authoring', () => {
  it('adds connected conditions, configures independent branches and prevents a loop', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: '＋ Add step' }, { timeout: 5000 }));
    await user.click(screen.getByRole('button', { name: /approved/ }));
    const first = policy().rules[0]!.id;
    expect(policy().entry).toEqual({ goto: first });
    await user.selectOptions(screen.getByLabelText('If not matched'), '"ALLOW"');
    await user.selectOptions(screen.getByLabelText('If matched'), 'new');
    await user.click(screen.getByRole('button', { name: /approved/ }));
    const second = policy().rules[1]!.id;
    expect(policy().rules[0]!.then).toEqual({ goto: second });
    await user.selectOptions(screen.getByLabelText('If matched'), JSON.stringify({ goto: first }));
    expect(screen.getByRole('alert').textContent).toContain('loop');
    expect(policy().rules[1]!.then).toBe('DENY');
    await user.selectOptions(screen.getByLabelText('If unknown'), '"CHALLENGE"');
    expect(policy().rules[1]!.on_verified).toBe('DENY');
    await user.selectOptions(screen.getByLabelText('If verified'), '"ALLOW"');
    expect(policy().rules[1]!.on_verified).toBe('ALLOW');
    await user.click(screen.getByRole('button', { name: 'Remove step' }));
    expect(policy().rules[0]!.then).toBe('DENY');
  });
  it('inspects published routes on the canvas without a duplicate steps list', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PolicyRead
          policy={{
            ...initial,
            rules: [
              {
                id: 'a',
                condition: { op: 'known', value: { source: 'input', name: 'approved' } },
                then: 'ALLOW',
                on_false: 'DENY',
                on_unknown: 'DENY',
              },
            ],
          }}
        />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Inspect' }));
    await user.selectOptions(screen.getByLabelText('Select step'), 'a');
    expect(screen.getByText(/Not reachable from entry/)).toBeTruthy();
    expect(document.querySelector('ol.rules')).toBeNull();
    expect(
      (screen.getByRole('button', { name: '＋ Add step' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('If not matched')).toBeTruthy();
  });
  it('builds separate branches and rejoins an existing step through the picker', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: '＋ Add step' }));
    await user.click(screen.getByRole('button', { name: /^approved/ }));
    const root = policy().rules[0]!.id;
    await user.selectOptions(screen.getByLabelText('If matched'), 'new');
    await user.click(screen.getByRole('button', { name: /^approved/ }));
    const left = policy().rules[1]!.id;
    await user.selectOptions(screen.getByLabelText('If matched'), 'new');
    await user.click(screen.getByRole('button', { name: /^approved/ }));
    const join = policy().rules[2]!.id;
    await user.selectOptions(screen.getByLabelText('Select step'), root);
    await user.selectOptions(screen.getByLabelText('If not matched'), 'new');
    await user.click(screen.getByRole('button', { name: /^approved/ }));
    const right = policy().rules[3]!.id;
    await user.selectOptions(screen.getByLabelText('If matched'), 'new');
    expect(screen.queryByRole('button', { name: /Step 1 · Backend input/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Step 3 · Backend input/ }));
    expect(policy().rules.find((r) => r.id === root)!.then).toEqual({ goto: left });
    expect(policy().rules.find((r) => r.id === root)!.on_false).toEqual({ goto: right });
    expect(policy().rules.find((r) => r.id === left)!.then).toEqual({ goto: join });
    expect(policy().rules.find((r) => r.id === right)!.then).toEqual({ goto: join });
    await user.click(screen.getByRole('button', { name: 'Undo workflow edit' }));
    expect(policy().rules.find((r) => r.id === right)!.then).toBe('DENY');
  });
  it('keeps terminal-node selection separate from entry editing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Inspect' }, { timeout: 5000 }));
    const select = await screen.findByRole('combobox', { name: 'Select step' }, { timeout: 5000 });
    await user.selectOptions(select, '$allow');
    expect(screen.getByRole('heading', { name: 'Allow action' })).toBeTruthy();
    expect(screen.queryByLabelText('Start at')).toBeNull();
    expect(policy().entry).toBe('DENY');
    await user.selectOptions(select, '$deny');
    expect(screen.getByRole('heading', { name: 'Deny action' })).toBeTruthy();
    expect(screen.queryByLabelText('Start at')).toBeNull();
    await user.selectOptions(select, '$entry');
    expect(screen.getByLabelText('Start at')).toBeTruthy();
    expect(policy().entry).toBe('DENY');
  });
});
