import { describe, expect, it } from 'vitest';
import {
  CLIENT_ADDRESS_HEADER,
  createClientAddressResolver,
  parseTrustedProxy,
  withClientAddress,
} from './client-address.js';

describe('the address a request is counted under', () => {
  it('is the address of the socket when no proxy is trusted, whatever X-Forwarded-For says', () => {
    const resolve = createClientAddressResolver([]);
    expect(resolve('203.0.113.9', null)).toBe('203.0.113.9');
    expect(resolve('203.0.113.9', '198.51.100.1')).toBe('203.0.113.9');
    expect(resolve('::ffff:203.0.113.9', '198.51.100.1, 10.0.0.1')).toBe('203.0.113.9');
    expect(resolve('2001:db8::7', null)).toBe('2001:db8::7');
  });

  it('is unknown for a request without a socket', () => {
    expect(createClientAddressResolver(['10.0.0.0/8'])(null, '198.51.100.1')).toBeNull();
    expect(createClientAddressResolver([])('not an address', null)).toBeNull();
  });

  it('is read from X-Forwarded-For only when the socket is a trusted proxy', () => {
    const resolve = createClientAddressResolver(['10.0.0.0/8', '::1']);
    expect(resolve('10.0.0.5', '198.51.100.1')).toBe('198.51.100.1');
    expect(resolve('::1', '198.51.100.1')).toBe('198.51.100.1');
    // Not from a proxy: the header is the client's own claim.
    expect(resolve('203.0.113.9', '198.51.100.1')).toBe('203.0.113.9');
    // A trusted proxy that added nothing.
    expect(resolve('10.0.0.5', null)).toBe('10.0.0.5');
  });

  it('is the first address from the right that is not a trusted proxy, so what a client put in front is not believed', () => {
    const resolve = createClientAddressResolver(['10.0.0.0/8']);
    // The client sent "1.2.3.4"; the outer proxy appended the real address.
    expect(resolve('10.0.0.5', '1.2.3.4, 198.51.100.1')).toBe('198.51.100.1');
    expect(resolve('10.0.0.5', '1.2.3.4, 198.51.100.1, 10.0.0.9')).toBe('198.51.100.1');
    // Every hop is a proxy: the socket is all there is.
    expect(resolve('10.0.0.5', '10.0.0.7, 10.0.0.9')).toBe('10.0.0.5');
    // Something that is not an address ends the reading.
    expect(resolve('10.0.0.5', '198.51.100.1, nonsense')).toBe('10.0.0.5');
  });

  it('reads an entry as an address or a range, and nothing else', () => {
    expect(parseTrustedProxy('10.0.0.0/8')).toEqual({
      address: '10.0.0.0',
      prefix: 8,
      family: 'ipv4',
    });
    expect(parseTrustedProxy(' 192.168.1.7 ')).toEqual({
      address: '192.168.1.7',
      prefix: 32,
      family: 'ipv4',
    });
    expect(parseTrustedProxy('fd00::/8')).toEqual({ address: 'fd00::', prefix: 8, family: 'ipv6' });
    for (const bad of [
      '',
      'proxy.example',
      '10.0.0.0/33',
      '10.0.0.0/x',
      '10.0.0.0/8/8',
      '::1/129',
    ]) {
      expect(parseTrustedProxy(bad), bad).toBeNull();
    }
  });

  it('reaches Better Auth in a header of the server’s own, with the client’s versions removed', async () => {
    const original = new Request('http://localhost:4400/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '1.2.3.4',
        [CLIENT_ADDRESS_HEADER]: '5.6.7.8',
        cookie: 'a=b',
      },
      body: '{"email":"a@example.com"}',
    });
    const passed = withClientAddress(original, '203.0.113.9');
    expect(passed.headers.get(CLIENT_ADDRESS_HEADER)).toBe('203.0.113.9');
    expect(passed.headers.get('x-forwarded-for')).toBeNull();
    expect(passed.headers.get('cookie')).toBe('a=b');
    expect(passed.method).toBe('POST');
    expect(await passed.json()).toEqual({ email: 'a@example.com' });

    const unknown = withClientAddress(
      new Request('http://localhost:4400/api/auth/get-session', {
        headers: { [CLIENT_ADDRESS_HEADER]: '5.6.7.8' },
      }),
      null,
    );
    expect(unknown.headers.get(CLIENT_ADDRESS_HEADER)).toBeNull();
  });
});
