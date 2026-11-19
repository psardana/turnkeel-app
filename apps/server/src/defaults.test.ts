import { describe, expect, it } from 'vitest';
import { DEFAULT_HOST, DEFAULT_PORT } from './index.js';

describe('defaults', () => {
  it('binds to the loopback address', () => {
    expect(DEFAULT_HOST).toBe('127.0.0.1');
  });

  it('listens on port 4400', () => {
    expect(DEFAULT_PORT).toBe(4400);
  });
});
