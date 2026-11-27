import { describe, expect, it } from 'vitest';
import { DEV_ORIGINS, DEV_PORT, proxiedOrigin } from './proxy-origin';

const SERVER = 'http://127.0.0.1:4400';

describe('the Origin the dev server passes on to the Turnkeel server', () => {
  it('is the server’s own for a request from a page of the dev server', () => {
    expect(DEV_PORT).toBe(4401);
    for (const origin of DEV_ORIGINS) expect(proxiedOrigin(origin, SERVER)).toBe(SERVER);
    expect(proxiedOrigin('HTTP://LOCALHOST:4401', SERVER)).toBe(SERVER);
  });

  it('is left as it is for a page of any other origin, so the server refuses its writes', () => {
    for (const origin of [
      'http://127.0.0.1:5173',
      'http://localhost:3000',
      'http://127.0.0.1:44010',
      'https://evil.example',
      'null',
    ]) {
      expect(proxiedOrigin(origin, SERVER)).toBe(origin);
    }
  });

  it('is absent when the request had none', () => {
    expect(proxiedOrigin(undefined, SERVER)).toBeUndefined();
  });
});
