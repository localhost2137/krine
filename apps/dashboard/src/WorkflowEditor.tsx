// Workspace, contextual picker and panel interactions adapted from golden-sach's workflow editor.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ReactFlowProvider, type Connection } from '@xyflow/react';
import { Link, useSearchParams } from 'react-router-dom';
import { ConditionEditor } from './PolicyEditor';
import { PolicyFlow } from './PolicyFlow';
import {
  branchLabel,
  challenges,
  portLabel,
  reachableSteps,
  removeStep,
  workflowError,
  type Port,
} from './workflow';
import { conditionLabel, usesInput } from './policy';
import { api } from './api';
import { checkPath } from './addresses';
import {
  arrangeSteps,
  blockCatalog,
  branchAt,
  conditionIdentity,
  connectBranch,
  insertBlock,
  policyForConnection,
  type Block,
  type Insertion,
  type PreviewEvaluation,
} from './workflow/blocks';
import { WorkflowIcon } from './workflow/Icon';
import { TestPanel } from './workflow/TestPanel';
import type { Branch, Metric, Page, Policy, ValueType, Version } from './types';

type Panel = 'inspect' | 'test' | 'issues' | 'history' | 'inputs';
function Destination({
  label,
  value,
  policy,
  onChange,
  onAdd,
  allowVerification = true,
}: {
  label: string;
  value: Branch | 'NEXT' | undefined;
  policy: Policy;
  onChange: (branch: Branch) => void;
  onAdd: () => void;
  allowVerification?: boolean;
}) {
  return (
    <label>
      {label}
      <select
        value={JSON.stringify(value)}
        onChange={(e) =>
          e.target.value === 'new' ? onAdd() : onChange(JSON.parse(e.target.value) as Branch)
        }
      >
        <option value={'"DENY"'}>Deny</option>
        <option value={'"ALLOW"'}>Allow</option>
        {allowVerification && <option value={'"CHALLENGE"'}>Require verification</option>}
        {policy.rules.map((r, i) => (
          <option key={r.id} value={JSON.stringify({ goto: r.id })}>
            Step {i + 1} · {conditionIdentity(r.condition).title}
          </option>
        ))}
        <option value="new">＋ Choose next step…</option>
      </select>
    </label>
  );
}
export function WorkflowEditor(props: {
  policy: Policy;
  metrics: Metric[];
  onChange: (policy: Policy) => void;
  readOnly?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
function Editor({
  policy,
  metrics,
  onChange,
  readOnly = false,
}: {
  policy: Policy;
  metrics: Metric[];
  onChange: (policy: Policy) => void;
  readOnly?: boolean;
}) {
  const frame = useRef<HTMLDialogElement>(null),
    stage = useRef<HTMLDivElement>(null),
    searchRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false),
    [panel, setPanel] = useState<Panel | null>(null),
    [selection, setSelection] = useState('$entry');
  const [picker, setPicker] = useState<{ point: Insertion; left: number; top: number } | null>(
      null,
    ),
    [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null),
    [run, setRun] = useState<PreviewEvaluation | null>(null),
    [fit, setFit] = useState(0),
    [revealId, setRevealId] = useState<string | null>(null);
  const [past, setPast] = useState<Policy[]>([]),
    [future, setFuture] = useState<Policy[]>([]);
  const expected = useRef(policy);
  const [params] = useSearchParams();
  useEffect(() => {
    const d = frame.current;
    if (!d) return;
    d.close();
    expanded ? d.showModal() : d.show();
    return () => d.close();
  }, [expanded]);
  useEffect(() => {
    if (picker) {
      setQuery('');
      searchRef.current?.focus();
    }
  }, [picker]);
  useEffect(() => {
    if (JSON.stringify(policy) !== JSON.stringify(expected.current)) {
      setPast([]);
      setFuture([]);
      setRun(null);
    }
    expected.current = policy;
  }, [policy]);
  useEffect(() => {
    if (!selection.startsWith('$') && !policy.rules.some((r) => r.id === selection))
      setSelection('$entry');
  }, [policy, selection]);
  const selected = policy.rules.find((r) => r.id === selection),
    reachable = reachableSteps(policy);
  const catalog = useMemo(() => blockCatalog(policy, metrics), [policy, metrics]);
  const warnings = policy.rules.filter((r) => !reachable.has(r.id));
  function commit(next: Policy) {
    if (readOnly) return false;
    const issue = workflowError(next);
    if (issue) {
      setError(issue);
      return false;
    }
    setPast((previous) => [...previous, policy].slice(-50));
    setFuture([]);
    setRun(null);
    setError(null);
    expected.current = next;
    onChange(next);
    return true;
  }
  function undo() {
    const previous = past.at(-1);
    if (!previous) return;
    setPast(past.slice(0, -1));
    setFuture([policy, ...future].slice(0, 50));
    expected.current = previous;
    setRun(null);
    setError(null);
    onChange(previous);
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, policy]);
    expected.current = next;
    setRun(null);
    setError(null);
    onChange(next);
  }
  const openPicker = useCallback(
    (source: string, port: Port | 'entry', anchor?: { x: number; y: number }) => {
      const box = stage.current?.getBoundingClientRect();
      let left = 16,
        top = 16;
      if (anchor && box) {
        const x = anchor.x - box.left;
        left = Math.max(12, Math.min(x + 300 < box.width ? x + 16 : x - 296, box.width - 292));
        top = Math.max(12, Math.min(anchor.y - box.top - 50, box.height - 300));
      }
      setPicker({ point: { source, port }, left, top });
      setPanel(null);
    },
    [],
  );
  function choose(block: Block) {
    if (!picker) return;
    const id = `step_${crypto.randomUUID()}`;
    const next = insertBlock(policy, picker.point, block, id);
    if (commit(next)) {
      setSelection(block.condition ? id : picker.point.source);
      setPicker(null);
      setPanel('inspect');
      if (block.condition) setRevealId(id);
    }
  }
  function connect(c: Connection) {
    const next = policyForConnection(policy, c.source, c.sourceHandle, c.target);
    if (next) commit(next);
  }
  function remove(ids: string[], edges: { source: string; port: string }[]) {
    let next = policy;
    for (const id of ids) next = removeStep(next, id);
    for (const edge of edges) {
      const source = edge.source.startsWith('$verify:') ? edge.source.slice(8) : edge.source;
      if (source !== '$entry' && !next.rules.some((r) => r.id === source)) continue;
      if (edge.port === 'failure') continue;
      next = connectBranch(next, { source, port: edge.port as Port | 'entry' }, 'DENY');
    }
    if (commit(next)) {
      setSelection('$entry');
      setPanel('issues');
    }
  }
  function select(id: string) {
    setSelection(id);
    setPanel('inspect');
    setPicker(null);
  }
  const branch = picker ? branchAt(policy, picker.point) : undefined;
  const matching = catalog.filter((b) =>
    `${b.title} ${b.description} ${b.group}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const existingTargets = picker
    ? policy.rules.flatMap((rule, index) => {
        const candidate = connectBranch(policy, picker.point, { goto: rule.id });
        const label = `Step ${index + 1} · ${conditionIdentity(rule.condition).title}`;
        return workflowError(candidate) ||
          !`${label} ${conditionLabel(rule.condition)}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())
          ? []
          : [{ rule, candidate, label }];
      })
    : [];
  const recommended =
    picker?.point.port === 'on_unknown'
      ? ['deny', 'verify']
      : ['browser.automation_observed', 'session.event_count_5m', 'ip.risk', 'custom'];
  const groups = query.trim()
    ? ['Search results']
    : ['Suggested next', ...new Set(catalog.map((b) => b.group))];
  const issue = workflowError(policy);
  return (
    <>
      <dialog
        ref={frame}
        className={`workflow-frame graph-workspace ${expanded ? 'expanded' : ''}`}
        aria-label="Workflow editor"
        onCancel={(e) => {
          e.preventDefault();
          if (picker) setPicker(null);
          else setExpanded(false);
        }}
      >
        <div className="graph-toolbar">
          <div className="graph-toolbar-group">
            <button
              className="primary"
              disabled={readOnly}
              onClick={() => openPicker(selected?.id ?? '$entry', selected ? 'then' : 'entry')}
            >
              ＋ Add step
            </button>
            <span className="graph-count">
              {policy.rules.length} conditions · {policy.rules.filter(challenges).length}{' '}
              verifications
            </span>
          </div>
          <div className="graph-toolbar-group">
            <button
              onClick={undo}
              disabled={!past.length}
              aria-label="Undo workflow edit"
              title="Undo last edit"
            >
              ↶
            </button>
            <button
              onClick={redo}
              disabled={!future.length}
              aria-label="Redo workflow edit"
              title="Redo edit"
            >
              ↷
            </button>
            <button
              disabled={readOnly}
              onClick={() => {
                if (commit(arrangeSteps(policy))) setFit((f) => f + 1);
              }}
            >
              Arrange
            </button>
            <button onClick={() => setFit((f) => f + 1)}>Fit chart</button>
            <span className="toolbar-divider" />
            {(
              [
                ['inspect', 'Inspect'],
                ['test', 'Test path'],
                ['issues', `Issues${warnings.length ? ' · ' + warnings.length : ''}`],
                ['history', 'Versions'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                disabled={readOnly && id === 'test'}
                aria-pressed={panel === id}
                className={panel === id ? 'active' : ''}
                onClick={() => {
                  setPicker(null);
                  setPanel(panel === id ? null : id);
                }}
              >
                {label}
              </button>
            ))}{' '}
            <button
              onClick={() => {
                setExpanded(!expanded);
                setFit((f) => f + 1);
              }}
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="graph-error">
            {error}
            <button aria-label="Dismiss workflow error" onClick={() => setError(null)}>
              ×
            </button>
          </p>
        )}
        <div className="graph-stage" ref={stage}>
          <PolicyFlow
            policy={policy}
            selected={selection}
            onSelect={select}
            onConnect={readOnly ? undefined : connect}
            onMove={
              readOnly
                ? undefined
                : (id, position) =>
                    commit({
                      ...policy,
                      rules: policy.rules.map((r) => (r.id === id ? { ...r, position } : r)),
                    })
            }
            onInsert={readOnly ? undefined : openPicker}
            onDelete={readOnly ? undefined : remove}
            onPaneClick={() => {
              setPicker(null);
              setPanel(null);
            }}
            run={run}
            fitRevision={fit}
            revealId={revealId}
          />
          {picker && (
            <aside
              className="graph-picker"
              role="dialog"
              aria-label="Choose next step"
              style={{ left: picker.left, top: picker.top }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setPicker(null);
                }
              }}
            >
              <div className="graph-picker-search">
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search steps"
                  placeholder="Search steps…"
                />
                <button aria-label="Close step picker" onClick={() => setPicker(null)}>
                  ×
                </button>
              </div>
              <p className="graph-picker-context">
                {picker.point.source === '$entry'
                  ? 'After request'
                  : `${portLabel[picker.point.port as Port]} branch`}{' '}
                · {branchLabel(branch, policy)}
              </p>
              <div className="graph-picker-items">
                {existingTargets.length > 0 && (
                  <div>
                    <h3>Connect to existing step</h3>
                    {existingTargets.map(({ rule: r, candidate, label }) => {
                      return (
                        <button
                          key={r.id}
                          className="graph-palette-item"
                          onClick={() => {
                            if (commit(candidate)) {
                              setPicker(null);
                              setSelection(r.id);
                              setPanel('inspect');
                            }
                          }}
                        >
                          <WorkflowIcon name={conditionIdentity(r.condition).icon} />
                          <span>
                            <strong>{label}</strong>
                            <small>Join this path · {conditionLabel(r.condition)}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {groups.map((group) => {
                  const blocks =
                    group === 'Search results'
                      ? matching
                      : group === 'Suggested next'
                        ? matching.filter((b) => recommended.includes(b.id))
                        : matching.filter((b) => b.group === group && !recommended.includes(b.id));
                  return blocks.length ? (
                    <div key={group}>
                      <h3>{group}</h3>
                      {blocks.map((block) => {
                        const replacesChain = !!block.action && typeof branch === 'object';
                        const disabled =
                          (!!block.condition && policy.rules.length >= 32) ||
                          (block.action === 'CHALLENGE' &&
                            (picker.point.source === '$entry' ||
                              picker.point.port === 'on_verified'));
                        return (
                          <button
                            key={block.id}
                            disabled={disabled}
                            className="graph-palette-item"
                            title={block.description}
                            onClick={() => choose(block)}
                          >
                            <WorkflowIcon name={block.icon} />
                            <span>
                              <strong>{block.title}</strong>
                              <small>
                                {replacesChain
                                  ? 'Replaces this branch’s current connection'
                                  : block.description}
                              </small>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null;
                })}
                {matching.length === 0 && existingTargets.length === 0 && (
                  <p className="help">No matching steps.</p>
                )}
              </div>
              <button
                className="graph-picker-footer"
                onClick={() => {
                  setPicker(null);
                  setPanel('inputs');
                }}
              >
                Manage trusted backend inputs →
              </button>
            </aside>
          )}
          {panel && !picker && (
            <aside className="graph-details" aria-label="Workflow details">
              <div className="graph-details-heading">
                <strong>
                  {
                    {
                      inspect: 'Step inspector',
                      test: 'Test this path',
                      issues: 'Workflow health',
                      history: 'Published versions',
                      inputs: 'Backend inputs',
                    }[panel]
                  }
                </strong>
                <button aria-label="Close details" onClick={() => setPanel(null)}>
                  ×
                </button>
              </div>
              <div className="graph-details-body">
                {panel === 'test' ? (
                  <TestPanel
                    policy={policy}
                    metrics={metrics}
                    onResult={setRun}
                    onSelect={(id) => setSelection(id)}
                  />
                ) : panel === 'history' ? (
                  <WorkflowVersions name={params.get('name')} />
                ) : panel === 'inputs' ? (
                  <WorkflowInputs policy={policy} onChange={commit} />
                ) : panel === 'issues' ? (
                  <div className="graph-help">
                    <p>
                      Every branch has an explicit destination. Loops and missing steps are rejected
                      before saving.
                    </p>
                    {issue ? (
                      <p className="error">{issue}</p>
                    ) : (
                      <p className="graph-healthy">✓ Connections are valid</p>
                    )}
                    {warnings.map((r) => (
                      <button key={r.id} onClick={() => select(r.id)}>
                        Unreachable: {conditionIdentity(r.condition).title}
                      </button>
                    ))}
                    <p>
                      Deleting a condition or connection sends affected incoming branches to Deny.
                      Undo restores the previous draft.
                    </p>
                    <p>
                      Draft edits are saved automatically. Published policies only change after
                      review and publication.
                    </p>
                  </div>
                ) : (
                  <>
                    <label>
                      Select step
                      <select
                        value={selected?.id ?? selection}
                        onChange={(e) => setSelection(e.target.value)}
                      >
                        <option value="$entry">Workflow entry</option>
                        {policy.rules.map((r, i) => (
                          <option value={r.id} key={r.id}>
                            Step {i + 1} · {conditionIdentity(r.condition).title}
                          </option>
                        ))}
                        <option value="$allow">Allow action</option>
                        <option value="$deny">Deny action</option>
                      </select>
                    </label>
                    <div className="graph-inspector-title">
                      <WorkflowIcon
                        name={
                          selected
                            ? conditionIdentity(selected.condition).icon
                            : selection === '$allow'
                              ? 'allow'
                              : selection === '$deny'
                                ? 'deny'
                                : 'request'
                        }
                      />
                      <h2>
                        {selected
                          ? conditionIdentity(selected.condition).title
                          : selection === '$allow'
                            ? 'Allow action'
                            : selection === '$deny'
                              ? 'Deny action'
                              : 'Workflow entry'}
                      </h2>
                    </div>
                    {readOnly ? (
                      <ReadOnlyStep policy={policy} selectedId={selection} />
                    ) : selected ? (
                      <>
                        {!reachable.has(selected.id) && (
                          <p className="notice">
                            Not reachable from entry. This step will not run.
                          </p>
                        )}
                        <ConditionEditor
                          key={selected.id}
                          policy={policy}
                          metrics={metrics}
                          condition={selected.condition}
                          onChange={(condition) =>
                            commit({
                              ...policy,
                              rules: policy.rules.map((r) =>
                                r.id === selected.id ? { ...r, condition } : r,
                              ),
                            })
                          }
                        />
                        <h3>Branch destinations</h3>
                        <div className="branch-fields">
                          {(['then', 'on_false', 'on_unknown'] as Port[]).map((port) => (
                            <Destination
                              key={port}
                              label={portLabel[port]}
                              policy={policy}
                              value={selected[port]}
                              onChange={(b) =>
                                commit(connectBranch(policy, { source: selected.id, port }, b))
                              }
                              onAdd={() => openPicker(selected.id, port)}
                            />
                          ))}
                        </div>
                        {challenges(selected) && (
                          <div className="verification-panel">
                            <Destination
                              label="If verified"
                              policy={policy}
                              value={selected.on_verified}
                              allowVerification={false}
                              onChange={(b) =>
                                commit(
                                  connectBranch(
                                    policy,
                                    { source: selected.id, port: 'on_verified' },
                                    b,
                                  ),
                                )
                              }
                              onAdd={() => openPicker(selected.id, 'on_verified')}
                            />
                            <p className="help">
                              Failed, expired or unavailable verification → Deny.
                            </p>
                          </div>
                        )}
                        <button className="remove-step" onClick={() => remove([selected.id], [])}>
                          Remove step
                        </button>
                        <p className="help">Incoming connections become Deny.</p>
                      </>
                    ) : selection === '$allow' || selection === '$deny' ? (
                      <p className="help">
                        This outcome ends evaluation. Connect a branch to this node to select it as
                        the outcome.
                      </p>
                    ) : (
                      <>
                        <p className="help">
                          Your backend requests this check before executing a protected action.
                        </p>
                        <Destination
                          label="Start at"
                          policy={policy}
                          value={policy.entry}
                          allowVerification={false}
                          onChange={(entry) => commit({ ...policy, entry })}
                          onAdd={() => openPicker('$entry', 'entry')}
                        />
                        <button className="graph-manage-inputs" onClick={() => setPanel('inputs')}>
                          Manage backend inputs
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </aside>
          )}
        </div>
        <div className="graph-statusbar">
          <span className={warnings.length ? '' : 'graph-healthy'}>
            {warnings.length
              ? `${warnings.length} unreachable step${warnings.length === 1 ? '' : 's'}`
              : '✓ All steps reachable'}
          </span>
          <span>
            {run
              ? `Synthetic test: ${run.outcome.replaceAll('_', ' ')}`
              : readOnly
                ? 'Read-only preview'
                : 'Draft edits save automatically · Review and publish to activate'}
          </span>
        </div>
      </dialog>
    </>
  );
}
function WorkflowVersions({ name }: { name: string | null }) {
  const [versions, setVersions] = useState<Version[] | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (name)
      void api
        .get<Page<Version>>(checkPath(name, '/versions'))
        .then((v) => {
          if (active) setVersions(v.items);
        })
        .catch((e) => {
          if (active) setError(e instanceof Error ? e.message : 'Could not load versions.');
        });
    return () => {
      active = false;
    };
  }, [name]);
  if (!name) return <p className="help">Save this check to inspect its published versions.</p>;
  return (
    <div className="graph-versions">
      <p className="help">
        Versions are immutable. Open a version to inspect or restore it through the review flow.
      </p>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : versions === null ? (
        <p>Loading…</p>
      ) : versions.length === 0 ? (
        <p>No published versions yet.</p>
      ) : (
        versions.map((v) => (
          <Link key={v.version} to={`?name=${encodeURIComponent(name)}&version=${v.version}`}>
            <strong>Version {v.version}</strong>
            <span>
              {v.policy.rules.length} conditions · schema {v.policy.schema_version}
            </span>
          </Link>
        ))
      )}
    </div>
  );
}
function WorkflowInputs({
  policy,
  onChange,
}: {
  policy: Policy;
  onChange: (policy: Policy) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form),
      name = String(data.get('name') ?? '');
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(name) || Object.hasOwn(policy.inputs, name)) {
      setError(
        'Choose a unique name with 1–128 letters, numbers, dots, colons, hyphens or underscores.',
      );
      return;
    }
    onChange({ ...policy, inputs: { ...policy.inputs, [name]: data.get('type') as ValueType } });
    setError(null);
    form.reset();
  }
  return (
    <details>
      <summary>Trusted backend inputs</summary>
      <p className="help">
        Declare values supplied by your application backend. Browser properties are never
        authoritative inputs.
      </p>
      {Object.entries(policy.inputs).map(([name, type]) => (
        <div className="input-declaration" key={name}>
          <span>
            <code>{name}</code> · {type}
          </span>
          <button
            disabled={policy.rules.some((r) => usesInput(r.condition, name))}
            onClick={() => {
              const inputs = { ...policy.inputs };
              delete inputs[name];
              onChange({ ...policy, inputs });
            }}
          >
            Remove {name}
          </button>
        </div>
      ))}
      <form className="inline-fields" onSubmit={add}>
        <label>
          Input name
          <input name="name" required maxLength={128} autoComplete="off" />
        </label>
        <label>
          Input type
          <select name="type">
            <option value="number">Number</option>
            <option value="string">String</option>
            <option value="boolean">Boolean</option>
          </select>
        </label>
        <button disabled={Object.keys(policy.inputs).length >= 32}>Add input</button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </details>
  );
}

function ReadOnlyStep({ policy, selectedId }: { policy: Policy; selectedId: string }) {
  const rule = policy.rules.find((r) => r.id === selectedId);
  if (selectedId === '$entry')
    return (
      <>
        <p className="help">Start at {branchLabel(policy.entry, policy)}.</p>
        <h3>Trusted backend inputs</h3>
        {Object.keys(policy.inputs).length === 0 ? (
          <p className="help">No declared inputs.</p>
        ) : (
          <dl className="workflow-routes">
            {Object.entries(policy.inputs).map(([name, type]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{type}</dd>
              </div>
            ))}
          </dl>
        )}
      </>
    );
  if (!rule) return <p className="help">This outcome ends evaluation.</p>;
  return (
    <>
      <p>{conditionLabel(rule.condition)}</p>
      {!reachableSteps(policy).has(rule.id) && (
        <p className="notice">Not reachable from entry; this step will not run.</p>
      )}
      <dl className="workflow-routes">
        {(
          ['then', 'on_false', 'on_unknown', ...(challenges(rule) ? ['on_verified'] : [])] as Port[]
        ).map((port) => (
          <div key={port}>
            <dt>{portLabel[port]}</dt>
            <dd>{branchLabel(rule[port], policy)}</dd>
          </div>
        ))}
      </dl>
      {challenges(rule) && (
        <p className="help">Failed, expired or unavailable verification → deny.</p>
      )}
    </>
  );
}
export function WorkflowRead({ policy }: { policy: Policy }) {
  return <WorkflowEditor policy={policy} metrics={[]} onChange={() => {}} readOnly />;
}
