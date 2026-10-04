import { useEffect, useMemo, useRef, useState } from 'react';
import { api, mutation } from '../api';
import { challenges } from '../workflow';
import { references, conditionIdentity, type PreviewEvaluation } from './blocks';
import type { Metric, Policy, Scalar, ValueType } from '../types';

export function TestPanel({
  policy,
  metrics,
  onResult,
  onSelect,
}: {
  policy: Policy;
  metrics: Metric[];
  onResult: (run: PreviewEvaluation | null) => void;
  onSelect: (id: string) => void;
}) {
  const refs = useMemo(
    () => [
      ...new Map(
        policy.rules
          .flatMap((r) => references(r.condition))
          .map((ref) => [`${ref.source}:${ref.name}`, ref]),
      ).values(),
    ],
    [policy],
  );
  const [samples, setSamples] = useState<Record<string, { known: boolean; raw: string }>>({});
  const [verification, setVerification] = useState('pending');
  const [result, setResult] = useState<PreviewEvaluation | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setResult(null);
    setBusy(false);
    onResult(null);
    return () => {
      epoch.current++;
    };
  }, [policy, onResult]);
  function update(key: string, value: { known: boolean; raw: string }) {
    epoch.current++;
    setBusy(false);
    setSamples({ ...samples, [key]: value });
    setResult(null);
    onResult(null);
  }
  function valueType(source: string, name: string): ValueType {
    return source === 'input'
      ? (policy.inputs[name] ?? 'string')
      : (metrics.find((m) => m.name === name)?.value_type ?? 'string');
  }
  async function run() {
    const generation = ++epoch.current;
    setBusy(true);
    setError(null);
    setResult(null);
    onResult(null);
    try {
      const snapshot: { inputs: Record<string, Scalar>; metrics: Record<string, unknown> } = {
        inputs: {},
        metrics: {},
      };
      for (const ref of refs) {
        const s = samples[`${ref.source}:${ref.name}`];
        if (!s?.known) continue;
        const type = valueType(ref.source, ref.name),
          value = type === 'boolean' ? s.raw === 'true' : type === 'number' ? Number(s.raw) : s.raw;
        if (type === 'number' && (!s.raw.trim() || !Number.isFinite(value)))
          throw new Error(`Enter a valid number for ${ref.name}.`);
        if (ref.source === 'input') snapshot.inputs[ref.name] = value;
        else
          snapshot.metrics[ref.name] = {
            version: ref.version,
            state: { status: 'known', value },
            provenance: { source: 'synthetic_preview', observed_at: 0 },
          };
      }
      const preview = await api.run<{ synthetic: true; evaluation: PreviewEvaluation }>(
        mutation('/policy-preview', {
          policy,
          snapshot,
          verification:
            verification === 'pending'
              ? {}
              : Object.fromEntries(
                  policy.rules.filter(challenges).map((r) => [r.id, verification]),
                ),
        }),
      );
      if (generation !== epoch.current) return;
      setResult(preview.evaluation);
      onResult(preview.evaluation);
    } catch (e) {
      if (generation === epoch.current)
        setError(e instanceof Error ? e.message : 'Preview failed.');
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  return (
    <div className="graph-test-panel">
      <p className="help">
        Test this draft with sample evidence. Uses Krine’s evaluator; does not publish, call
        providers, or record a live decision.
      </p>
      {refs.length === 0 && (
        <p className="help">This workflow has no evidence conditions. Test its entry decision.</p>
      )}
      {refs.map((ref) => {
        const key = `${ref.source}:${ref.name}`,
          s = samples[key] ?? {
            known: false,
            raw:
              valueType(ref.source, ref.name) === 'boolean'
                ? 'false'
                : valueType(ref.source, ref.name) === 'number'
                  ? '0'
                  : '',
          },
          type = valueType(ref.source, ref.name);
        return (
          <fieldset className="sample-field" key={key}>
            <legend>{ref.name}</legend>
            <span className="help">
              {ref.source === 'input' ? 'Backend input' : `Metric · v${ref.version}`}
            </span>
            <label>
              Evidence state
              <select
                aria-label={`${ref.name} evidence state`}
                value={s.known ? 'known' : 'unknown'}
                onChange={(e) => update(key, { ...s, known: e.target.value === 'known' })}
              >
                <option value="unknown">Unknown / missing</option>
                <option value="known">Known value</option>
              </select>
            </label>
            {s.known &&
              (type === 'boolean' ? (
                <label>
                  Value
                  <select
                    aria-label={`${ref.name} sample value`}
                    value={s.raw}
                    onChange={(e) => update(key, { ...s, raw: e.target.value })}
                  >
                    <option value="false">False</option>
                    <option value="true">True</option>
                  </select>
                </label>
              ) : (
                <label>
                  Value
                  <input
                    aria-label={`${ref.name} sample value`}
                    type={type === 'number' ? 'number' : 'text'}
                    value={s.raw}
                    onChange={(e) => update(key, { ...s, raw: e.target.value })}
                  />
                </label>
              ))}
          </fieldset>
        );
      })}
      {policy.rules.some(challenges) && (
        <label>
          Simulated verification
          <select
            value={verification}
            onChange={(e) => {
              epoch.current++;
              setBusy(false);
              setVerification(e.target.value);
              setResult(null);
              onResult(null);
            }}
          >
            <option value="pending">Awaiting verification</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
            <option value="expired">Expired</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
      )}
      <button className="primary graph-run" onClick={() => void run()} disabled={busy}>
        {busy ? 'Evaluating…' : 'Run test'}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result && (
        <div className="graph-test-result" role="status">
          <strong className={`result-${result.outcome.toLowerCase()}`}>
            {result.outcome.replaceAll('_', ' ')}
          </strong>
          <p className="help">Synthetic result · highlighted on the canvas</p>
          <ol>
            {result.trace.map((step, index) => (
              <li key={step.rule_id}>
                <button onClick={() => onSelect(step.rule_id)}>
                  <span>
                    {index + 1}.{' '}
                    {
                      conditionIdentity(policy.rules.find((r) => r.id === step.rule_id)!.condition)
                        .title
                    }
                  </span>
                  <small>
                    {step.condition.result} → {step.route.replaceAll('_', ' ')}
                  </small>
                </button>
              </li>
            ))}
          </ol>
          {result.trace.length === 0 && (
            <p className="help">Entry leads directly to this decision.</p>
          )}
        </div>
      )}
    </div>
  );
}
