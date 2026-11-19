import type { Ref } from '@turnkeel/protocol';
import { describe, expect, it } from 'vitest';
import { sameRef } from './index.js';

const id = '0192f0c1-7a3e-7b1c-9d2e-4f5a6b7c8d9e';
const otherId = '0192f0c1-7a3e-7b1c-9d2e-000000000000';

describe('sameRef', () => {
  it('is true for the same kind and id', () => {
    expect(sameRef({ kind: 'user', id }, { kind: 'user', id })).toBe(true);
  });

  it('compares ids without regard to case', () => {
    expect(sameRef({ kind: 'agent', id }, { kind: 'agent', id: id.toUpperCase() })).toBe(true);
  });

  it('is false when the kind differs', () => {
    const user: Ref = { kind: 'user', id };
    const agent: Ref = { kind: 'agent', id };
    expect(sameRef(user, agent)).toBe(false);
  });

  it('is false when the id differs', () => {
    expect(sameRef({ kind: 'party', id }, { kind: 'party', id: otherId })).toBe(false);
  });
});
