import type { Ref } from '@turnkeel/protocol';

/** True when two refs name the same person, agent or party. Ids are compared without regard to case. */
export function sameRef(a: Ref, b: Ref): boolean {
  return a.kind === b.kind && a.id.toLowerCase() === b.id.toLowerCase();
}
