import type { IconName } from './blocks';
const paths: Record<IconName, string> = {
  request: 'm8 5 11 7-11 7Z',
  condition: 'm12 3 9 9-9 9-9-9Z',
  automation: 'M5 8h14v12H5z M12 3v5 M9 12v3 M15 12v3 M9 18h6',
  velocity: 'M4 17a9 9 0 1 1 16 0 M12 14l5-6 M8 20h8',
  identity:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.9 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  network: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2',
  input: 'M5 4H3v16h2 M19 4h2v16h-2 M8 9l3 3-3 3 M13 15h3',
  verify: 'm12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7Z m-4 9 3 3 5-6',
  allow: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 m-14 0 3 3 6-6',
  deny: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M6 6l12 12',
};
export function WorkflowIcon({ name }: { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
