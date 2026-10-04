import { BaseEdge, useStore, type EdgeProps } from '@xyflow/react';
import { useMemo } from 'react';
import { routeEdge, edgePath } from './edge-routing';
export function RoutedEdge(props: EdgeProps) {
  // Copy geometry: nodeLookup itself is mutable, including when another card moves.
  const obstacles = useStore(
    (s) =>
      [...s.nodeLookup.values()].map((n) => ({
        ...n.internals.positionAbsolute,
        width: n.measured.width ?? 240,
        height: n.measured.height ?? 210,
      })),
    (a, b) =>
      a.length === b.length &&
      a.every((r, i) => {
        const other = b[i]!;
        return (
          r.x === other.x && r.y === other.y && r.width === other.width && r.height === other.height
        );
      }),
  );
  const lane =
    props.sourceHandleId === 'on_false' ? 1 : props.sourceHandleId === 'on_unknown' ? 2 : 0;
  const path = useMemo(
    () =>
      edgePath(
        routeEdge(
          { x: props.sourceX, y: props.sourceY },
          { x: props.targetX, y: props.targetY },
          obstacles,
          lane,
        ),
      ),
    [props.sourceX, props.sourceY, props.targetX, props.targetY, obstacles, lane],
  );
  return (
    <BaseEdge
      id={props.id}
      path={path}
      style={props.style}
      {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})}
      interactionWidth={props.interactionWidth ?? 24}
    />
  );
}
