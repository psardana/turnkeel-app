import { passkey } from '@better-auth/passkey';
import { canCreateAccount, canSignInWith } from '@turnkeel/core';
import {
  countSignInAccounts,
  findUserByEmail,
  hasOpenInvitation,
  schema,
  type Database,
} from '@turnkeel/db';
import { DISPLAY_NAME_MAX } from '@turnkeel/protocol';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import type { Config } from '../config.js';
import { CLIENT_ADDRESS_HEADER } from '../http/client-address.js';
import type { Logger } from '../log.js';
import type { Mailer } from '../mail/mailer.js';
import { messages } from '../messages.js';

/** How long a sign-in link works, in minutes. */
export const SIGN_IN_LINK_MINUTES = 10;

/** How many sign-in links go to one address within `SIGN_IN_LINK_LIMIT_MINUTES`. Further requests get the same answer and no mail. */
export const SIGN_IN_LINKS_PER_ADDRESS = 3;
export const SIGN_IN_LINK_LIMIT_MINUTES = 10;

/** How many addresses the count of sent links remembers at most. */
const LINK_LIMIT_ADDRESSES = 10_000;

/**
 * Counts the sign-in links sent to each address, in memory. The limit on requests
 * per client address (Better Auth's) does not stop someone who uses many addresses
 * from filling one person's mailbox through the server's own mail; this does. Each
 * server process counts for itself.
 */
export function createLinkLimit(
  max: number = SIGN_IN_LINKS_PER_ADDRESS,
  windowMs: number = SIGN_IN_LINK_LIMIT_MINUTES * 60_000,
  now: () => number = Date.now,
) {
  const sent = new Map<string, number[]>();
  return {
    /** True when a link may go to this address now, and counts it. False when the address has had its share. */
    take(email: string): boolean {
      const key = email.trim().toLowerCase();
      const from = now() - windowMs;
      const recent = (sent.get(key) ?? []).filter((at) => at > from);
      if (recent.length >= max) {
        sent.set(key, recent);
        return false;
      }
      // Put back at the end, so the map's order is the order of last use.
      sent.delete(key);
      sent.set(key, [...recent, now()]);
      if (sent.size > LINK_LIMIT_ADDRESSES) {
        for (const [address, times] of sent) {
          if (sent.size <= LINK_LIMIT_ADDRESSES) break;
          if (address !== key && (times.at(-1) ?? 0) <= from) sent.delete(address);
        }
        for (const address of sent.keys()) {
          if (sent.size <= LINK_LIMIT_ADDRESSES) break;
          if (address !== key) sent.delete(address);
        }
      }
      return true;
    },
  };
}

/**
 * A display name as it is stored: one line, without control characters, at most
 * `DISPLAY_NAME_MAX` characters. A name is typed by its owner and then shown to
 * others, in the subject of the invitations they send and in every event they cause,
 * so it is bounded where it is written.
 */
export function cleanDisplayName(name: string): string {
  const oneLine = name
    // Control characters, line and paragraph separators.
    .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(oneLine).slice(0, DISPLAY_NAME_MAX).join('').trim();
}

/** The error code a refused sign-up carries. The sign-in page shows the sentence that comes
 * with it. */
export const SIGNUP_BY_INVITATION = 'signup_by_invitation';

/**
 * R44: whether a sign-in may make an account for an address. One is made by the first
 * sign-in on an install with no accounts, through an open invitation to that address,
 * or when open sign-up is on. `proven` says whether the sign-in showed that the
 * address belongs to the person; an invitation counts only for a proven address,
 * because it is sent to an address and accepted by whoever proves to hold it.
 */
export function createSignUpGate(db: Database, openSignup: boolean) {
  return async (input: { email: string; proven: boolean }): Promise<boolean> => {
    // Accounts that nobody can sign in to, such as the local owner, are not counted.
    const accountCount = await countSignInAccounts(db);
    const invited = input.proven && (await hasOpenInvitation(db, input.email));
    return canCreateAccount({ accountCount, openSignup, hasOpenInvitation: invited }).allowed;
  };
}

export interface AuthOptions {
  signIn: NonNullable<Config['signIn']>;
  db: Database;
  mailer: Mailer;
  logger: Logger;
  /** How many sign-in links one address is sent, and within how many minutes. The two constants above unless given. */
  linkLimit?: { max: number; minutes: number } | undefined;
}

/**
 * Sign-in, with Better Auth. It provides identity only: users, sessions,
 * linked accounts, verification tokens and passkeys. Its organization plugin is not
 * used; members and invitations are Turnkeel's own.
 *
 * - Magic link is always there. The link goes through the `Mailer`.
 * - GitHub and Google are there when their client id and secret are set.
 * - A passkey is added by a signed-in person and cannot be the first way in.
 * - R44 is enforced where Better Auth creates an account (`validateUserInfo`), whatever
 *   the method, and before a sign-in link is sent.
 */
export function createAuth({ signIn, db, mailer, logger, linkLimit: limit }: AuthOptions) {
  // Better Auth sends usage data only when asked to. Neither the option nor the
  // variable may ask.
  process.env.BETTER_AUTH_TELEMETRY = '0';

  const publicUrl = new URL(signIn.publicUrl);
  const mayCreateAccount = createSignUpGate(db, signIn.openSignup);
  const linksPerAddress = limit?.max ?? SIGN_IN_LINKS_PER_ADDRESS;
  const linkLimitMinutes = limit?.minutes ?? SIGN_IN_LINK_LIMIT_MINUTES;
  const linkLimit = createLinkLimit(linksPerAddress, linkLimitMinutes * 60_000);

  /** Bounds the name of an account wherever one is written. A name that is not text is refused. */
  const boundName = (account: { name?: unknown }) => {
    if (account.name === undefined || account.name === null) return Promise.resolve();
    if (typeof account.name !== 'string') return Promise.resolve(false as const);
    return Promise.resolve({ data: { ...account, name: cleanDisplayName(account.name) } });
  };

  return betterAuth({
    appName: 'Turnkeel',
    baseURL: signIn.publicUrl,
    basePath: '/api/auth',
    secret: signIn.authSecret,
    trustedOrigins: [publicUrl.origin],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        passkey: schema.passkey,
      },
    }),
    advanced: {
      // The ids are UUIDs, so a user id fits a ref.
      database: { generateId: 'uuid' },
      cookiePrefix: 'turnkeel',
      useSecureCookies: publicUrl.protocol === 'https:',
      // The address a request is counted under comes from the server itself, in a
      // header it sets for every sign-in request (`withClientAddress`). Better Auth
      // would otherwise read `X-Forwarded-For`, which a client can send.
      ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] },
    },
    // Better Auth limits requests per client address and path: sign-in links to 5 a
    // minute, everything else to 100 in 10 seconds. Left alone it does so only when
    // NODE_ENV is production, which nothing but the image sets.
    rateLimit: { enabled: true, storage: 'memory' },
    databaseHooks: { user: { create: { before: boundName }, update: { before: boundName } } },
    telemetry: { enabled: false },
    logger: {
      level: 'warn',
      log(level, message) {
        const line = messages.log.authLog(level, message);
        if (level === 'error') logger.error(line);
        else logger.warn(line);
      },
    },
    socialProviders: {
      ...(signIn.github === null ? {} : { github: signIn.github }),
      ...(signIn.google === null ? {} : { google: signIn.google }),
    },
    user: {
      async validateUserInfo({ user, source }) {
        if (source.action !== 'create-user') return;
        const allowed = await mayCreateAccount({
          email: typeof user.email === 'string' ? user.email : '',
          // A magic link proves the address. A provider does only when it says so.
          proven: source.method !== 'oauth' || user.emailVerified === true,
        });
        if (allowed) return;
        return {
          error: SIGNUP_BY_INVITATION,
          errorDescription: messages.auth.byInvitationOnly,
        };
      },
    },
    plugins: [
      magicLink({
        expiresIn: SIGN_IN_LINK_MINUTES * 60,
        // Only the hash of a sign-in token is stored.
        storeToken: 'hashed',
        async sendMagicLink({ email, url }) {
          try {
            // A request for an address that has no account and may not get
            // one is answered like any other, and nothing is sent. Both lookups run
            // for every address, so the time the answer takes does not say which
            // kind of address it was.
            const [account, mayCreate] = await Promise.all([
              findUserByEmail(db, email),
              mayCreateAccount({ email, proven: true }),
            ]);
            // Nobody signs in with an address under `.invalid`, the local owner's
            // included, so no link for one is ever sent or logged.
            const due = canSignInWith(email) && (account !== null || mayCreate);
            if (!due) {
              logger.info(messages.log.signInNotSent);
              return;
            }
            if (!linkLimit.take(email)) {
              logger.warn(messages.log.signInLimit(linksPerAddress, linkLimitMinutes));
              return;
            }
            // Not awaited, for the same reason: an address that gets a link would
            // otherwise answer one mail delivery later than one that gets none. A mail
            // that cannot be sent is logged; the answer never said whether one went out.
            void mailer
              .send({
                to: email,
                subject: messages.mail.signInSubject,
                text: messages.mail.signInText({ url, minutes: SIGN_IN_LINK_MINUTES }),
              })
              .catch((error: unknown) => logger.error(messages.log.mailFailed(email), error));
          } catch (error) {
            // The answer stays the same whether or not a mail went out.
            logger.error(messages.log.mailFailed(email), error);
          }
        },
      }),
      passkey({
        rpID: publicUrl.hostname,
        rpName: 'Turnkeel',
        origin: publicUrl.origin,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
