import { countSignInAccounts, countUsers, createUser, schema } from '@turnkeel/db';
import { deferred } from '@turnkeel/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MailMessage } from '../mail/mailer.js';
import {
  createTestServer,
  SERVER_URL,
  TEST_CLIENT_ADDRESS_HEADER,
  type TestServer,
} from '../testing/harness.js';
import {
  cleanDisplayName,
  createLinkLimit,
  SIGN_IN_LINK_LIMIT_MINUTES,
  SIGN_IN_LINKS_PER_ADDRESS,
} from './auth.js';

/** Asks for a sign-in link as a client at `address`, with whatever other headers the test wants. */
function ask(
  t: TestServer,
  email: string,
  address: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return t.request('POST', '/api/auth/sign-in/magic-link', {
    json: { email, callbackURL: '/' },
    headers: { origin: SERVER_URL, [TEST_CLIENT_ADDRESS_HEADER]: address, ...headers },
  });
}

describe('limits on asking for a sign-in link', () => {
  let t: TestServer;

  beforeAll(async () => {
    // The limit on links per address as it is shipped, not the one the other tests raise.
    t = await createTestServer('pglite', { runtime: { signInLinkLimit: undefined } });
    const owner = await t.signIn('olive@example.com', 'Olive Owner');
    await t.post('/api/v1/workspaces', { name: 'Acme', slug: 'acme', handle: 'olive' }, owner);
  }, 60_000);
  afterAll(async () => {
    await t.stop();
  }, 60_000);

  it('are on without NODE_ENV=production: the sixth request in a minute from one address is refused, and another address is not', async () => {
    expect(process.env.NODE_ENV).not.toBe('production');
    const statuses: number[] = [];
    for (let request = 1; request <= 6; request += 1) {
      statuses.push((await ask(t, `nobody-${request}@example.com`, '203.0.113.10')).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await ask(t, 'nobody@example.com', '203.0.113.11')).status).toBe(200);
  });

  it('count a client under the address the server saw, whatever X-Forwarded-For it sends', async () => {
    const statuses: number[] = [];
    for (let request = 1; request <= 6; request += 1) {
      const response = await ask(t, `forger-${request}@example.com`, '203.0.113.20', {
        'x-forwarded-for': `198.51.100.${request}`,
        'x-turnkeel-client-ip': `198.51.100.${request}`,
      });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('send one address three links in ten minutes, and answer the fourth request the same without a mail', async () => {
    expect([SIGN_IN_LINKS_PER_ADDRESS, SIGN_IN_LINK_LIMIT_MINUTES]).toEqual([3, 10]);
    // One was sent when the owner signed in above. Each request is another client.
    const toOlive = () => t.mail.filter((mail) => mail.to.toLowerCase() === 'olive@example.com');
    expect(toOlive()).toHaveLength(1);
    const answers: unknown[] = [];
    for (let request = 2; request <= 5; request += 1) {
      const response = await ask(t, 'Olive@Example.com', `203.0.113.${30 + request}`);
      expect(response.status).toBe(200);
      answers.push(await response.json());
    }
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
    expect(toOlive()).toHaveLength(3);
    expect(t.log.some((line) => line.includes('A further one was asked for and not sent.'))).toBe(
      true,
    );
  });
});

describe('the count of links per address', () => {
  it('allows the limit within the window, without regard to case, and again when the window has passed', () => {
    let now = 1_000_000;
    const limit = createLinkLimit(3, 10 * 60_000, () => now);
    expect([1, 2, 3, 4].map(() => limit.take('a@example.com'))).toEqual([true, true, true, false]);
    expect(limit.take(' A@Example.com ')).toBe(false);
    expect(limit.take('b@example.com')).toBe(true);
    now += 10 * 60_000 + 1;
    expect(limit.take('a@example.com')).toBe(true);
  });
});

describe('asking for a link when the mail server is slow', () => {
  it('answers for a known address without waiting for the mail, like for an unknown one', async () => {
    const held = deferred();
    const sends: MailMessage[] = [];
    let hold = false;
    const t = await createTestServer('pglite', {
      mailer: {
        kind: 'smtp',
        async send(message) {
          sends.push(message);
          t.mail.push(message);
          if (hold) await held.promise;
        },
        close: () => Promise.resolve(),
      },
    });
    try {
      const owner = await t.signIn('olive@example.com', 'Olive Owner');
      await t.post('/api/v1/workspaces', { name: 'Acme', slug: 'acme', handle: 'olive' }, owner);
      hold = true;
      const before = sends.length;
      const timeout = new Promise<'no answer'>((resolve) =>
        setTimeout(() => resolve('no answer'), 5000),
      );
      const known = await Promise.race([t.askForLink('olive@example.com'), timeout]);
      expect(known).not.toBe('no answer');
      if (known === 'no answer') return;
      expect(known.response.status).toBe(200);
      // The mail was handed to the mailer, which still holds it.
      expect(sends).toHaveLength(before + 1);
      const unknown = await t.askForLink('nobody@example.com');
      expect(await unknown.response.json()).toEqual(await known.response.json());
      expect(sends).toHaveLength(before + 1);
    } finally {
      held.resolve();
      await t.stop();
    }
  }, 60_000);

  it('logs a mail that could not be sent, and the answer is the same', async () => {
    let fail = false;
    const t = await createTestServer('pglite', {
      mailer: {
        kind: 'smtp',
        send(message) {
          if (fail) return Promise.reject(new Error('no route'));
          t.mail.push(message);
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
      },
    });
    try {
      await t.signIn('olive@example.com', 'Olive Owner');
      fail = true;
      const asked = await t.askForLink('olive@example.com');
      expect(asked.response.status).toBe(200);
      expect(await asked.response.json()).toEqual({ status: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(
        t.log.some((line) => line.includes('Mail to olive@example.com could not be sent.')),
      ).toBe(true);
    } finally {
      await t.stop();
    }
  }, 60_000);
});

describe('a display name', () => {
  it('is one line without control characters, at most 80 characters long', () => {
    expect(cleanDisplayName('  Olive\r\n\tOwner\u0000  ')).toBe('Olive Owner');
    expect(cleanDisplayName('x'.repeat(500))).toHaveLength(80);
    expect(Array.from(cleanDisplayName('🙂'.repeat(100)))).toHaveLength(80);
    expect(cleanDisplayName('\n\n')).toBe('');
  });

  it('is bounded when a person changes it, so an invitation’s subject and an event’s actor stay short', async () => {
    const t = await createTestServer('pglite');
    try {
      const owner = await t.signIn('olive@example.com', 'Olive Owner');
      await t.post('/api/v1/workspaces', { name: 'Acme', slug: 'acme', handle: 'olive' }, owner);
      const long = `Olive\nBcc: someone@example.com\r\n${'x'.repeat(500)}`;
      const changed = await t.request('POST', '/api/auth/update-user', {
        as: owner,
        json: { name: long },
        headers: { origin: SERVER_URL },
      });
      expect(changed.status).toBe(200);
      const [account] = await t.test.db.select().from(schema.user);
      expect(account?.name).toHaveLength(80);
      expect(account?.name).not.toMatch(/[\r\n]/);
      expect(account?.name.startsWith('Olive Bcc: someone@example.com x')).toBe(true);

      const invited = await t.post(
        '/api/v1/workspaces/acme/invitations',
        { email: 'new@example.com', role: 'viewer' },
        owner,
      );
      expect(invited.status).toBe(201);
      const mail = t.mail.findLast((message) => message.to === 'new@example.com');
      expect(mail?.subject.length).toBeLessThan(200);
      expect(mail?.subject).not.toMatch(/[\r\n]/);

      // A name that is not text is not stored, whatever Better Auth answers.
      await t.request('POST', '/api/auth/update-user', {
        as: owner,
        json: { name: { long: true } },
        headers: { origin: SERVER_URL },
      });
      const [after] = await t.test.db.select().from(schema.user);
      expect(after?.name).toBe(account?.name);
    } finally {
      await t.stop();
    }
  }, 60_000);

  it('is bounded when a sign-in link makes the account', async () => {
    const t = await createTestServer('pglite');
    try {
      await t.signIn('olive@example.com', `Olive\n${'y'.repeat(300)}`);
      const [account] = await t.test.db.select().from(schema.user);
      expect(account?.name).toHaveLength(80);
      expect(account?.name).not.toMatch(/[\r\n]/);
    } finally {
      await t.stop();
    }
  }, 60_000);
});

describe('an account that nobody can sign in to (R44)', () => {
  it('is not counted as an account, gets no sign-in link, and leaves the first sign-in to a person', async () => {
    const t = await createTestServer('pglite');
    try {
      // What the server makes for itself: the local owner, and the people a demo seeds.
      await createUser(t.test.db, { name: 'Owner', email: 'owner@turnkeel.invalid' });
      expect(await countUsers(t.test.db)).toBe(1);
      expect(await countSignInAccounts(t.test.db)).toBe(0);

      // The account exists, and still no link is sent or logged for it.
      const asked = await t.askForLink('owner@turnkeel.invalid');
      expect(asked.response.status).toBe(200);
      expect(asked.mail).toBeUndefined();
      expect(t.mail).toEqual([]);
      expect(t.log.join('\n')).not.toContain('magic-link/verify');

      // The first person to sign in is still the first.
      await t.signIn('olive@example.com', 'Olive Owner');
      expect(await countSignInAccounts(t.test.db)).toBe(1);
      const later = await t.askForLink('second@example.com');
      expect(later.mail).toBeUndefined();
    } finally {
      await t.stop();
    }
  }, 60_000);
});
