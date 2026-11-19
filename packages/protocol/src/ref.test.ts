import { describe, expect, it } from 'vitest';
import { refKinds, refSchema } from './index.js';

const id = '0192f0c1-7a3e-7b1c-9d2e-4f5a6b7c8d9e';

describe('refSchema', () => {
  it.each(refKinds)('accepts a %s ref', (kind) => {
    expect(refSchema.parse({ kind, id })).toEqual({ kind, id });
  });

  it('rejects a kind that is not on the list', () => {
    expect(refSchema.safeParse({ kind: 'system', id }).success).toBe(false);
  });

  it('rejects an id that is not a UUID', () => {
    expect(refSchema.safeParse({ kind: 'user', id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects fields it does not know', () => {
    expect(refSchema.safeParse({ kind: 'user', id, role: 'owner' }).success).toBe(false);
  });
});
