// Connector/lens interaction ported from the owner's golden-sach graph-nodes.tsx.
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useEffect, useRef, type PointerEvent } from 'react';
import { createGlassOptics, GLASS_OVERSCAN, GLASS_RADIUS } from './glass-optics';
import { WorkflowIcon } from './Icon';
import type { IconName } from './blocks';
export interface Output {
  id: string;
  label: string;
  tone: string;
  fixed?: boolean;
}
export type FlowNode = Node<
  {
    title: string;
    subtitle: string;
    icon: IconName;
    kind: string;
    outputs: Output[];
    readOnly: boolean;
    warning?: string | undefined;
    onPath: boolean | null;
    onAdd?: ((port: string, anchor: { x: number; y: number }) => void) | undefined;
  },
  'step'
>;
export function GraphNode({ id, data, selected }: NodeProps<FlowNode>) {
  const node = { id };
  const pointerStart = useRef({ x: 0, y: 0 });
  const lens = useRef<HTMLDivElement | null>(null);
  const clearLens = () => {
    lens.current?.remove();
    lens.current = null;
  };
  useEffect(
    () => () => {
      lens.current?.remove();
    },
    [],
  );
  const moveLens = (event: PointerEvent<HTMLDivElement>) => {
    if (!data.onAdd || event.pointerType === 'touch' || event.buttons) {
      clearLens();
      return;
    }
    const canvas = event.currentTarget.closest('.react-flow');
    const viewport = canvas?.querySelector('.react-flow__viewport');
    if (!canvas || !viewport) return;
    if (!lens.current) {
      const glass = document.createElement('div');
      glass.className = 'workflow-canvas react-flow dark workflow-lens';
      glass.setAttribute('aria-hidden', 'true');
      glass.inert = true;
      const optics = createGlassOptics(glass);
      const scene = document.createElement('div');
      scene.className = 'workflow-lens-scene';
      const copy = viewport.cloneNode(true) as HTMLElement;
      // Decorative snapshot only: never duplicate accessible controls or document IDs.
      for (const element of copy.querySelectorAll('[id]')) element.removeAttribute('id');
      for (const icon of copy.querySelectorAll<SVGElement>('.workflow-output svg'))
        icon.style.opacity = '1';
      // A cloned element cannot inherit :hover. Preserve the active connector's
      // enlarged state explicitly so the lens magnifies the growing dot and +.
      const handleId = event.currentTarget.getAttribute('data-handleid');
      for (const handle of copy.querySelectorAll<HTMLElement>('.workflow-output')) {
        if (
          handle.getAttribute('data-handleid') === handleId &&
          handle.closest('.react-flow__node')?.getAttribute('data-id') === node.id
        )
          handle.classList.add('workflow-output-active');
      }
      scene.appendChild(copy);
      optics.appendChild(scene);
      glass.appendChild(optics);
      (event.currentTarget.closest('dialog') ?? document.body).appendChild(glass);
      lens.current = glass;
    }
    const box = canvas.getBoundingClientRect();
    const glass = lens.current;
    glass.style.left = `${event.clientX - GLASS_RADIUS}px`;
    glass.style.top = `${event.clientY - GLASS_RADIUS}px`;
    const scene = glass.querySelector<HTMLElement>('.workflow-lens-scene')!;
    scene.style.width = `${box.width}px`;
    scene.style.height = `${box.height}px`;
    scene.style.transform = `translate(${GLASS_RADIUS + GLASS_OVERSCAN - (event.clientX - box.left) * 1.35}px, ${GLASS_RADIUS + GLASS_OVERSCAN - (event.clientY - box.top) * 1.35}px) scale(1.35)`;
  };
  return (
    <div
      className={`graph-block kind-${data.kind} ${selected ? 'selected' : ''} ${data.onPath === false ? 'off-path' : ''} ${data.onPath === true ? 'on-path' : ''} ${data.warning ? 'has-warning' : ''}`}
      title={data.warning}
    >
      {data.kind !== 'entry' && (
        <Handle type="target" position={Position.Left} isConnectable={!data.readOnly} />
      )}
      <div className="graph-block-heading">
        <span className={`block-icon icon-${data.icon}`}>
          <WorkflowIcon name={data.icon} />
        </span>
        <div>
          <strong>{data.title}</strong>
          <p>{data.subtitle}</p>
        </div>
        {data.warning && (
          <span className="block-warning" aria-label={data.warning}>
            !
          </span>
        )}
      </div>
      {data.outputs.length > 0 && (
        <div className="graph-block-outputs">
          {data.outputs.map((output) => (
            <div className="graph-output-row" key={output.id} style={{ color: output.tone }}>
              <span>{output.label}</span>
              <Handle
                id={output.id}
                type="source"
                position={Position.Right}
                isConnectable={!data.readOnly && !output.fixed}
                className={data.onAdd && !output.fixed ? 'workflow-output' : undefined}
                role={data.onAdd && !output.fixed ? 'button' : undefined}
                tabIndex={data.onAdd && !output.fixed ? 0 : undefined}
                aria-label={
                  data.readOnly || output.fixed
                    ? output.label
                    : `Add step after ${data.title}: ${output.label}`
                }
                onPointerEnter={output.fixed ? undefined : moveLens}
                onPointerMove={output.fixed ? undefined : moveLens}
                onPointerLeave={clearLens}
                onPointerCancel={clearLens}
                onBlur={clearLens}
                onPointerDown={(e) => {
                  clearLens();
                  pointerStart.current = { x: e.clientX, y: e.clientY };
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (
                    output.fixed ||
                    Math.hypot(
                      e.clientX - pointerStart.current.x,
                      e.clientY - pointerStart.current.y,
                    ) > 5
                  )
                    return;
                  const box = e.currentTarget.getBoundingClientRect();
                  data.onAdd?.(output.id, { x: box.right, y: box.top + box.height / 2 });
                }}
                onKeyDown={(e) => {
                  if (output.fixed || !['Enter', ' '].includes(e.key)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const box = e.currentTarget.getBoundingClientRect();
                  data.onAdd?.(output.id, { x: box.right, y: box.top + box.height / 2 });
                }}
                style={{ background: output.tone }}
              >
                {data.onAdd && !output.fixed && (
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                )}
              </Handle>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
