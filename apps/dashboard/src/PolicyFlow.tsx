// Canvas behavior adapted from golden-sach's workflow Editor and graph-nodes.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { conditionLabel } from './policy';
import { challenges, reachableSteps, targetId, workflowError, type Port } from './workflow';
import {
  arrangeSteps,
  conditionIdentity,
  policyForConnection,
  previewPath,
  verificationPositions,
  type PreviewEvaluation,
} from './workflow/blocks';
import { GraphNode, type FlowNode, type Output } from './workflow/GraphNode';
import { RoutedEdge } from './workflow/RoutedEdge';
import type { Branch, Policy } from './types';
const nodeTypes = { step: GraphNode };
const edgeTypes = { routed: RoutedEdge };
const colors = {
  then: 'var(--accent)',
  on_false: 'var(--muted)',
  on_unknown: 'var(--warn)',
  on_verified: 'var(--ok)',
  failure: 'var(--bad)',
  entry: 'var(--accent)',
};
const outputs: Output[] = [
  { id: 'then', label: 'Matched', tone: colors.then },
  { id: 'on_false', label: 'Not matched', tone: colors.on_false },
  { id: 'on_unknown', label: 'Unknown', tone: colors.on_unknown },
];
function CanvasViewport({ revision, revealId }: { revision: number; revealId: string | null }) {
  const initialized = useNodesInitialized(),
    flow = useReactFlow();
  const width = useStore((s) => s.width),
    height = useStore((s) => s.height);
  const fitted = useRef<number | null>(null),
    revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!initialized || !width || !height) return;
    const frame = requestAnimationFrame(() => {
      if (fitted.current !== revision) {
        fitted.current = revision;
        void flow.fitView({ padding: 0.12, maxZoom: 1, duration: 180 });
        return;
      }
      if (!revealId || revealed.current === revealId) return;
      const node = flow.getNode(revealId);
      if (!node?.measured?.width || !node.measured.height) return;
      revealed.current = revealId;
      const viewport = flow.getViewport(),
        zoom = viewport.zoom;
      const left = node.position.x * zoom + viewport.x,
        top = node.position.y * zoom + viewport.y;
      const right = left + node.measured.width * zoom,
        bottom = top + node.measured.height * zoom;
      const dx = left < 40 ? 40 - left : right > width - 40 ? width - 40 - right : 0;
      const dy = top < 40 ? 40 - top : bottom > height - 40 ? height - 40 - bottom : 0;
      if (dx || dy)
        void flow.setViewport(
          { ...viewport, x: viewport.x + dx, y: viewport.y + dy },
          { duration: 180 },
        );
    });
    return () => cancelAnimationFrame(frame);
  }, [initialized, revision, revealId, width, height, flow]);
  return null;
}
export function PolicyFlow({
  policy,
  selected,
  onSelect,
  onConnect,
  onMove,
  onInsert,
  onDelete,
  onPaneClick,
  run,
  fitRevision = 0,
  revealId = null,
}: {
  policy: Policy;
  selected?: string | null | undefined;
  onSelect?: ((id: string) => void) | undefined;
  onConnect?: ((c: Connection) => void) | undefined;
  onMove?: ((id: string, p: { x: number; y: number }) => void) | undefined;
  onInsert?:
    | ((source: string, port: Port | 'entry', anchor: { x: number; y: number }) => void)
    | undefined;
  onDelete?: ((ids: string[], edges: { source: string; port: string }[]) => void) | undefined;
  onPaneClick?: (() => void) | undefined;
  run?: PreviewEvaluation | null | undefined;
  fitRevision?: number;
  revealId?: string | null;
}) {
  const readOnly = !onConnect;
  const layout = useMemo(() => {
    const connected = reachableSteps(policy),
      arranged = arrangeSteps(policy),
      path = run ? previewPath(run) : null;
    const positioned = policy.rules.map((r, i) => ({
      ...r,
      position: r.position ?? arranged.rules[i]!.position!,
    }));
    const verifications = verificationPositions(positioned);
    const add = (
      id: string,
      position: { x: number; y: number },
      title: string,
      subtitle: string,
      icon: FlowNode['data']['icon'],
      kind: string,
      ports: Output[],
      warning?: string,
    ): FlowNode => ({
      id,
      type: 'step',
      position,
      selected: selected === id,
      draggable: !id.startsWith('$'),
      deletable: !readOnly && !id.startsWith('$'),
      data: {
        title,
        subtitle,
        icon,
        kind,
        outputs: ports,
        readOnly,
        warning,
        onPath: path ? path.nodes.has(id) : null,
        onAdd: onInsert
          ? (port, anchor) =>
              onInsert(id.startsWith('$verify:') ? id.slice(8) : id, port as Port | 'entry', anchor)
          : undefined,
      },
    });
    const nodes: FlowNode[] = [
      add(
        '$entry',
        { x: 0, y: 100 },
        'Check requested',
        'Trusted backend action',
        'request',
        'entry',
        [{ id: 'entry', label: 'Continue', tone: colors.entry }],
      ),
    ];
    const edges: Edge[] = [];
    const edge = (source: string, port: string, branch: Branch) => {
      const color = colors[port as keyof typeof colors] ?? colors.entry,
        onPath = path?.edges.has(`${source}:${port}`);
      edges.push({
        id: `${source}:${port}`,
        source,
        sourceHandle: port,
        target: targetId(branch, source),
        type: 'routed',
        reconnectable: !readOnly && port !== 'failure' ? 'target' : false,
        deletable: !readOnly && port !== 'failure',
        animated: onPath === true,
        interactionWidth: 24,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color,
        },
        style: {
          stroke: color,
          strokeWidth: onPath ? 3.5 : 2.5,
          opacity: path && !onPath ? 0.18 : 1,
        },
        ariaLabel: `${source} ${port} to ${typeof branch === 'object' ? branch.goto : branch}`,
      });
    };
    if (policy.entry) edge('$entry', 'entry', policy.entry);
    policy.rules.forEach((r, i) => {
      const identity = conditionIdentity(r.condition),
        position = r.position ?? arranged.rules[i]!.position!;
      nodes.push(
        add(
          r.id,
          position,
          identity.title,
          conditionLabel(r.condition),
          identity.icon,
          'condition',
          outputs,
          connected.has(r.id) ? undefined : 'Not connected to entry; this step will not run.',
        ),
      );
      for (const port of ['then', 'on_false', 'on_unknown'] as Port[]) {
        const b = r[port];
        if (b && b !== 'NEXT') edge(r.id, port, b);
      }
      if (challenges(r)) {
        const id = `$verify:${r.id}`;
        nodes.push(
          add(
            id,
            verifications.get(r.id)!,
            'Display CAPTCHA',
            'Verify before continuing this request',
            'verify',
            'verification',
            [
              {
                id: 'on_verified',
                label: 'Verified',
                tone: colors.on_verified,
              },
              {
                id: 'failure',
                label: 'Failed / expired / unavailable',
                tone: colors.failure,
                fixed: true,
              },
            ],
          ),
        );
        if (r.on_verified) edge(id, 'on_verified', r.on_verified);
        edge(id, 'failure', 'DENY');
      }
    });
    const right = Math.max(340, ...nodes.map((n) => n.position.x + 340));
    nodes.push(
      add(
        '$allow',
        { x: right, y: 80 },
        'Allow action',
        'Accept the protected request',
        'allow',
        'allow',
        [],
      ),
      add(
        '$deny',
        { x: right, y: 410 },
        'Deny action',
        'Stop the protected request',
        'deny',
        'deny',
        [],
      ),
    );
    return { nodes, edges };
  }, [policy, selected, readOnly, onInsert, run]);
  const [nodes, setNodes] = useState(layout.nodes),
    [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  useEffect(
    () =>
      setNodes((previous) =>
        layout.nodes.map((n) => ({
          ...n,
          ...(previous.find((old) => old.id === n.id)?.measured
            ? { measured: previous.find((old) => old.id === n.id)!.measured }
            : {}),
        })),
      ),
    [layout],
  );
  return (
    <section className="policy-canvas workflow-canvas" aria-label="Workflow canvas">
      <ReactFlow<FlowNode>
        nodes={nodes}
        edges={layout.edges.map((e) => ({
          ...e,
          selected: selectedEdges.has(e.id),
        }))}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode="dark"
        fitView
        minZoom={0.2}
        maxZoom={1.8}
        connectOnClick={false}
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        edgesReconnectable={!readOnly}
        reconnectRadius={18}
        nodeExtent={[
          [-10000, -10000],
          [10000, 10000],
        ]}
        onNodesChange={(changes) => setNodes((current) => applyNodeChanges(changes, current))}
        onNodeClick={(_, n) => {
          setSelectedEdges(new Set());
          onSelect?.(n.id.startsWith('$verify:') ? n.id.slice(8) : n.id);
        }}
        onNodeDragStop={(_, n) => {
          if (!n.id.startsWith('$')) onMove?.(n.id, n.position);
        }}
        onEdgeClick={(_, e) => setSelectedEdges(new Set([e.id]))}
        onPaneClick={() => {
          setSelectedEdges(new Set());
          onPaneClick?.();
        }}
        onBeforeDelete={async ({ nodes: removed, edges }) => {
          onDelete?.(
            removed.filter((n) => !n.id.startsWith('$')).map((n) => n.id),
            edges
              .filter((e) => e.sourceHandle !== 'failure')
              .map((e) => ({ source: e.source, port: e.sourceHandle! })),
          );
          setSelectedEdges(new Set());
          return false;
        }}
        isValidConnection={(c) => {
          if (readOnly) return false;
          const next = policyForConnection(policy, c.source, c.sourceHandle, c.target);
          return !!next && !workflowError(next);
        }}
        {...(onConnect
          ? {
              onConnect,
              onReconnect: (_e: Edge, c: Connection) => onConnect(c),
            }
          : {})}
      >
        <CanvasViewport revision={fitRevision} revealId={revealId} />
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        {nodes.length > 8 && (
          <MiniMap pannable zoomable nodeColor="var(--subtle)" maskColor="rgba(16,16,18,0.65)" />
        )}
      </ReactFlow>
      <div className="graph-canvas-hint">
        {readOnly
          ? 'Read-only workflow preview'
          : 'Click a step to inspect · click an output to add · drag to connect · Delete removes a selection'}
      </div>
    </section>
  );
}
