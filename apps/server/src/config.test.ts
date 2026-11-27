import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_MAX_FILE_BYTES, isLocalModeHost, loadConfig } from './config.js';

const secret = 'a-secret-that-is-long-enough-to-be-one';
const signIn = {
  TURNKEEL_PUBLIC_URL: 'https://turnkeel.example.com',
  TURNKEEL_AUTH_SECRET: secret,
};

/** The problems `loadConfig` names for an environment. */
function problemsOf(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return [...error.problems];
    throw error;
  }
  return [];
}

describe('configuration from the environment', () => {
  it('with nothing set runs local mode on PGlite, on the loopback address and port 4400', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 4400,
      databaseUrl: null,
      databaseUrlDirect: null,
      dataDir: path.join(os.homedir(), '.turnkeel'),
      signIn: null,
      secretsKey: null,
      mail: null,
      storage: null,
      maxFileBytes: DEFAULT_MAX_FILE_BYTES,
      // The first run starts empty.
      demo: false,
      notices: [],
    });
    expect(DEFAULT_MAX_FILE_BYTES).toBe(100 * 1024 * 1024);
  });

  it('treats an empty value as not set', () => {
    expect(
      loadConfig({ TURNKEEL_PUBLIC_URL: '', DATABASE_URL: '  ', SMTP_URL: '' }).signIn,
    ).toBeNull();
  });

  it('reads every variable of the table', () => {
    const config = loadConfig({
      ...signIn,
      TURNKEEL_HOST: '0.0.0.0',
      TURNKEEL_PORT: '8080',
      DATABASE_URL: 'postgres://u:p@db:5432/turnkeel',
      DATABASE_URL_DIRECT: 'postgresql://u:p@db-direct:5432/turnkeel',
      TURNKEEL_DATA_DIR: '/var/lib/turnkeel',
      TURNKEEL_SECRETS_KEY: 'a-secrets-key-of-32-characters-x',
      SMTP_URL: 'smtp://mail:25',
      MAIL_FROM: 'Turnkeel <turnkeel@example.com>',
      GITHUB_CLIENT_ID: 'gh-id',
      GITHUB_CLIENT_SECRET: 'gh-secret',
      GOOGLE_CLIENT_ID: 'g-id',
      GOOGLE_CLIENT_SECRET: 'g-secret',
      TURNKEEL_OPEN_SIGNUP: 'true',
      S3_ENDPOINT: 'http://storage:9000',
      S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:9400/',
      S3_BUCKET: 'turnkeel',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_FORCE_PATH_STYLE: 'true',
      TURNKEEL_MAX_FILE_BYTES: '1048576',
      TURNKEEL_TRUSTED_PROXIES: '10.0.0.0/8, 192.168.1.7,fd00::/8',
    });
    expect(config).toEqual({
      host: '0.0.0.0',
      port: 8080,
      databaseUrl: 'postgres://u:p@db:5432/turnkeel',
      databaseUrlDirect: 'postgresql://u:p@db-direct:5432/turnkeel',
      dataDir: '/var/lib/turnkeel',
      signIn: {
        publicUrl: 'https://turnkeel.example.com',
        authSecret: secret,
        openSignup: true,
        github: { clientId: 'gh-id', clientSecret: 'gh-secret' },
        google: { clientId: 'g-id', clientSecret: 'g-secret' },
      },
      secretsKey: 'a-secrets-key-of-32-characters-x',
      mail: { smtpUrl: 'smtp://mail:25', from: 'Turnkeel <turnkeel@example.com>' },
      storage: {
        endpoint: 'http://storage:9000',
        publicEndpoint: 'http://127.0.0.1:9400',
        bucket: 'turnkeel',
        region: 'us-east-1',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        forcePathStyle: true,
      },
      maxFileBytes: 1_048_576,
      trustedProxies: ['10.0.0.0/8', '192.168.1.7', 'fd00::/8'],
      // With open sign-up the install offers no default; the assistant's own
      // variables are tested in http/assistant.test.ts.
      assistant: { default: null, dailyCap: 100 },
      demo: false,
      notices: [],
    });
  });

  it('only TURNKEEL_DEMO=true (turnkeel --demo) makes the first run of local mode load the demo', () => {
    expect(loadConfig({}).demo).toBe(false);
    expect(loadConfig({ TURNKEEL_DEMO: 'false' }).demo).toBe(false);
    expect(loadConfig({ TURNKEEL_DEMO: 'true' }).demo).toBe(true);
    expect(() => loadConfig({ TURNKEEL_DEMO: 'no' })).toThrow(ConfigError);
    const withSignIn = loadConfig({
      TURNKEEL_PUBLIC_URL: 'https://turnkeel.example.com',
      TURNKEEL_AUTH_SECRET: 'a-secret-of-at-least-32-characters-x',
      TURNKEEL_DEMO: 'false',
    });
    expect(withSignIn.notices).toContain(
      'TURNKEEL_DEMO is set and has no effect, because sign-in is on. The demo loads only in local mode.',
    );
  });

  it('trusts no proxy unless TURNKEEL_TRUSTED_PROXIES names one, and refuses what is not an address or a range', () => {
    expect(loadConfig({}).trustedProxies).toEqual([]);
    for (const value of ['proxy.example.com', '10.0.0.0/40', '10.0.0.1 10.0.0.2', 'true']) {
      const problems = problemsOf({ ...signIn, TURNKEEL_TRUSTED_PROXIES: value });
      expect(problems, value).toEqual([
        'TURNKEEL_TRUSTED_PROXIES must be a list of addresses or ranges with commas between them, such as 10.0.0.0/8,192.168.1.7.',
      ]);
    }
    expect(loadConfig({ TURNKEEL_TRUSTED_PROXIES: '10.0.0.1' }).notices).toEqual([
      'TURNKEEL_TRUSTED_PROXIES is set and has no effect, because sign-in is off. Set TURNKEEL_PUBLIC_URL to turn it on.',
    ]);
  });

  it('uses S3_ENDPOINT for browsers too when S3_PUBLIC_ENDPOINT is not set', () => {
    const config = loadConfig({
      S3_ENDPOINT: 'http://127.0.0.1:9400',
      S3_BUCKET: 'b',
      S3_REGION: 'r',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
    });
    expect(config.storage).toMatchObject({
      publicEndpoint: 'http://127.0.0.1:9400',
      forcePathStyle: false,
    });
  });

  describe('without sign-in the server listens on the loopback address only', () => {
    const NOT_A_LOCAL_HOST =
      'TURNKEEL_HOST is not an address the server listens on without sign-in. Without sign-in the server listens on 127.0.0.1, localhost or ::1 only. Set TURNKEEL_PUBLIC_URL to turn sign-in on, or leave TURNKEEL_HOST unset.';

    it.each(['0.0.0.0', '192.168.1.20', '::', 'turnkeel.example.com'])(
      'refuses TURNKEEL_HOST=%s without TURNKEEL_PUBLIC_URL',
      (host) => {
        const problems = problemsOf({ TURNKEEL_HOST: host });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('TURNKEEL_HOST');
        expect(problems[0]).toContain('TURNKEEL_PUBLIC_URL');
        // No value is repeated in a message. It is the same sentence for every host.
        expect(problems[0]).toBe(NOT_A_LOCAL_HOST);
        expect(isLocalModeHost(host)).toBe(false);
      },
    );

    it.each(['127.0.0.1', 'localhost', 'LOCALHOST', '::1'])('takes %s', (host) => {
      expect(loadConfig({ TURNKEEL_HOST: host }).host).toBe(host);
      expect(isLocalModeHost(host)).toBe(true);
    });

    it('takes [::1] and listens on ::1, which is how the address is written outside a URL', () => {
      expect(loadConfig({ TURNKEEL_HOST: '[::1]' }).host).toBe('::1');
    });

    // R33 lets a request name the server as 127.0.0.1, localhost or a name under
    // .localhost only, and none of them reaches another address of 127.0.0.0/8. A
    // server bound there would start and then refuse every request.
    it.each(['127.0.0.5', '127.0.0.2', '127.1.2.3'])(
      'refuses %s without sign-in, and takes it with sign-in',
      (host) => {
        const problems = problemsOf({ TURNKEEL_HOST: host });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toBe(NOT_A_LOCAL_HOST);
        expect(loadConfig({ ...signIn, TURNKEEL_HOST: host }).host).toBe(host);
      },
    );

    it('TURNKEEL_PUBLIC_URL turns sign-in on and lifts the limit', () => {
      const config = loadConfig({ ...signIn, TURNKEEL_HOST: '0.0.0.0' });
      expect(config.host).toBe('0.0.0.0');
      expect(config.signIn?.publicUrl).toBe('https://turnkeel.example.com');
    });
  });

  describe('refuses to start, naming the variable', () => {
    it('TURNKEEL_AUTH_SECRET is needed whenever sign-in is on', () => {
      const problems = problemsOf({ TURNKEEL_PUBLIC_URL: 'https://turnkeel.example.com' });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('TURNKEEL_AUTH_SECRET');
      expect(problemsOf({ ...signIn, TURNKEEL_AUTH_SECRET: 'short' })[0]).toContain(
        'TURNKEEL_AUTH_SECRET must be at least 32 characters long.',
      );
    });

    it.each([
      [
        { GITHUB_CLIENT_ID: 'id' },
        'GITHUB_CLIENT_ID is set and GITHUB_CLIENT_SECRET is not. Set both.',
      ],
      [
        { GITHUB_CLIENT_SECRET: 's' },
        'GITHUB_CLIENT_SECRET is set and GITHUB_CLIENT_ID is not. Set both.',
      ],
      [
        { GOOGLE_CLIENT_ID: 'id' },
        'GOOGLE_CLIENT_ID is set and GOOGLE_CLIENT_SECRET is not. Set both.',
      ],
      [
        { GOOGLE_CLIENT_SECRET: 's' },
        'GOOGLE_CLIENT_SECRET is set and GOOGLE_CLIENT_ID is not. Set both.',
      ],
      [{ SMTP_URL: 'smtp://mail:25' }, 'SMTP_URL is set and MAIL_FROM is not. Set both.'],
      [{ MAIL_FROM: 'a@example.com' }, 'MAIL_FROM is set and SMTP_URL is not. Set both.'],
      [{ S3_BUCKET: 'b' }, 'S3_BUCKET is set and S3_ENDPOINT is not. Set both.'],
      [
        { S3_PUBLIC_ENDPOINT: 'http://x' },
        'S3_PUBLIC_ENDPOINT is set and S3_ENDPOINT is not. Set both.',
      ],
      [
        { DATABASE_URL_DIRECT: 'postgres://x/y' },
        'DATABASE_URL_DIRECT is set, so DATABASE_URL must be set too.',
      ],
    ])('a half-set pair: %j', (env, problem) => {
      expect(problemsOf({ ...signIn, ...env })).toEqual([problem]);
    });

    it('names every missing part of the object store at once', () => {
      expect(problemsOf({ S3_ENDPOINT: 'http://storage:9000', S3_BUCKET: 'b' })).toEqual([
        'S3_ENDPOINT is set and S3_REGION is not. Set both.',
        'S3_ENDPOINT is set and S3_ACCESS_KEY_ID is not. Set both.',
        'S3_ENDPOINT is set and S3_SECRET_ACCESS_KEY is not. Set both.',
      ]);
    });

    it.each([
      [{ TURNKEEL_PUBLIC_URL: 'turnkeel.example.com' }, 'TURNKEEL_PUBLIC_URL'],
      [{ TURNKEEL_PUBLIC_URL: 'ftp://turnkeel.example.com' }, 'TURNKEEL_PUBLIC_URL'],
      [{ TURNKEEL_PUBLIC_URL: 'https://example.com/turnkeel' }, 'TURNKEEL_PUBLIC_URL'],
      [{ TURNKEEL_PORT: 'http' }, 'TURNKEEL_PORT'],
      [{ TURNKEEL_PORT: '70000' }, 'TURNKEEL_PORT'],
      [{ TURNKEEL_PORT: '0' }, 'TURNKEEL_PORT'],
      [{ DATABASE_URL: 'mysql://db/turnkeel' }, 'DATABASE_URL'],
      [{ SMTP_URL: 'mail.example.com', MAIL_FROM: 'a@example.com' }, 'SMTP_URL'],
      [{ TURNKEEL_OPEN_SIGNUP: 'yes' }, 'TURNKEEL_OPEN_SIGNUP'],
      [{ TURNKEEL_MAX_FILE_BYTES: '-1' }, 'TURNKEEL_MAX_FILE_BYTES'],
      [{ TURNKEEL_MAX_FILE_BYTES: '10MB' }, 'TURNKEEL_MAX_FILE_BYTES'],
    ])('a value that cannot be used: %j', (env, name) => {
      const problems = problemsOf(env);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.some((problem) => problem.includes(name))).toBe(true);
    });

    it('lists every problem in one message, so one start shows them all', () => {
      const env = { TURNKEEL_PORT: 'x', GITHUB_CLIENT_ID: 'id', TURNKEEL_HOST: '0.0.0.0' };
      expect(problemsOf(env)).toHaveLength(3);
      expect(() => loadConfig(env)).toThrow(/Turnkeel cannot start with this configuration\.\n- /);
    });
  });

  it('says, without stopping, that a sign-in setting has no effect while sign-in is off', () => {
    const config = loadConfig({
      GITHUB_CLIENT_ID: 'id',
      GITHUB_CLIENT_SECRET: 'secret',
      TURNKEEL_OPEN_SIGNUP: 'true',
    });
    expect(config.signIn).toBeNull();
    expect(config.notices).toEqual([
      'GITHUB_CLIENT_ID is set and has no effect, because sign-in is off. Set TURNKEEL_PUBLIC_URL to turn it on.',
      'TURNKEEL_OPEN_SIGNUP is set and has no effect, because sign-in is off. Set TURNKEEL_PUBLIC_URL to turn it on.',
    ]);
  });

  it('never puts a secret into a message', () => {
    const problems = problemsOf({
      TURNKEEL_PUBLIC_URL: 'https://turnkeel.example.com',
      TURNKEEL_AUTH_SECRET: 'short-secret',
      DATABASE_URL: 'mysql://user:hunter2@db/turnkeel',
    });
    expect(problems.join('\n')).not.toContain('short-secret');
    expect(problems.join('\n')).not.toContain('hunter2');
  });
});
