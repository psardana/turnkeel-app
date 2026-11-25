import type { Event, EventType } from '@turnkeel/protocol';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const WORKSPACE_ID = id(1);
export const OLIVE = { kind: 'user' as const, id: id(10), name: 'Olive Owner' };
export const ADA = { kind: 'user' as const, id: id(11), name: 'Ada Admin' };
export const NOTE = { type: 'project' as const, id: id(20) };
export const OTHER_NOTE = { type: 'project' as const, id: id(21) };

/** An event for a test. A type that a later step adds is cast to `EventType`. */
export function eventOf(
  seq: number,
  type: EventType,
  overrides: Partial<Omit<Event, 'seq' | 'type'>> = {},
): Event {
  return {
    seq,
    id: id(1000 + seq),
    workspaceId: WORKSPACE_ID,
    projectId: null,
    at: new Date(Date.UTC(2026, 10, 11, 9, 0, seq)).toISOString(),
    actor: OLIVE,
    via: 'web',
    tokenId: null,
    sessionId: null,
    requestId: id(5000 + seq),
    type,
    subject: NOTE,
    data: {},
    ...overrides,
  };
}

export { id as testId };
