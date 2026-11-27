import { BlockList, isIP } from 'node:net';
import type { Context } from 'hono';

/**
 * The header that carries the client's address to Better Auth, which counts sign-in
 * requests per address. The server sets it itself and removes whatever a client sent
 * under this name, so a client cannot choose the address it is counted under.
 */
export const CLIENT_ADDRESS_HEADER = 'x-turnkeel-client-ip';

/** The header a reverse proxy adds: the addresses a request came through, the client's first. */
export const FORWARDED_FOR_HEADER = 'x-forwarded-for';

interface Network {
  address: string;
  prefix: number;
  family: 'ipv4' | 'ipv6';
}

/** An address a socket reports, without the IPv6 wrapping of an IPv4 address. */
function plain(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address.trim());
  return mapped?.[1] ?? address.trim();
}

function familyOf(address: string): 'ipv4' | 'ipv6' | null {
  const version = isIP(address);
  return version === 4 ? 'ipv4' : version === 6 ? 'ipv6' : null;
}

/** One entry of `TURNKEEL_TRUSTED_PROXIES`: an address, or a range such as `10.0.0.0/8`. Null when it is neither. */
export function parseTrustedProxy(entry: string): Network | null {
  const [addressText = '', prefixText, ...rest] = entry.trim().split('/');
  if (rest.length > 0) return null;
  const address = plain(addressText);
  const family = familyOf(address);
  if (family === null) return null;
  const widest = family === 'ipv4' ? 32 : 128;
  if (prefixText === undefined) return { address, prefix: widest, family };
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  return prefix <= widest ? { address, prefix, family } : null;
}

/**
 * Says which address a request is counted under: `resolve(peer, forwardedFor)`.
 *
 * `peer` is the address of the socket, which nobody can forge. It is the client
 * itself unless the server runs behind a reverse proxy, where it is the proxy for
 * everyone. `X-Forwarded-For` is believed only when the peer is one of
 * `trustedProxies`; it is then read from the right, past every trusted proxy, to the
 * first address that is not one. That address was written by a proxy the operator
 * trusts. Whatever stands to its left was sent by the client and is not looked at.
 */
export function createClientAddressResolver(trustedProxies: readonly string[]) {
  const trusted = new BlockList();
  for (const entry of trustedProxies) {
    const network = parseTrustedProxy(entry);
    if (network) trusted.addSubnet(network.address, network.prefix, network.family);
  }
  const isTrusted = (address: string): boolean => {
    const family = familyOf(address);
    return family !== null && trusted.check(address, family);
  };

  return (peer: string | null, forwardedFor: string | null): string | null => {
    if (peer === null) return null;
    const direct = plain(peer);
    if (familyOf(direct) === null) return null;
    if (forwardedFor === null || !isTrusted(direct)) return direct;
    const chain = forwardedFor
      .split(',')
      .map((part) => plain(part))
      .filter((part) => part !== '');
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const hop = chain[index] ?? '';
      // Something a trusted proxy would not have written: stop believing the header.
      if (familyOf(hop) === null) return direct;
      if (!isTrusted(hop)) return hop;
    }
    return direct;
  };
}

/** The address of the socket a request arrived on, or null for a request made in process, which has none. */
export function socketAddress(c: Context): string | null {
  const env = c.env as
    { incoming?: { socket?: { remoteAddress?: string } }; server?: unknown } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? null;
}

/**
 * The request as Better Auth gets it: with the client's address in
 * `CLIENT_ADDRESS_HEADER` and without the headers a client could have used to name
 * an address of its own choosing.
 */
export function withClientAddress(request: Request, address: string | null): Request {
  const headers = new Headers(request.headers);
  headers.delete(FORWARDED_FOR_HEADER);
  headers.delete(CLIENT_ADDRESS_HEADER);
  if (address !== null) headers.set(CLIENT_ADDRESS_HEADER, address);
  return new Request(request, { headers });
}
