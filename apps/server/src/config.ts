import os from 'node:os';
import path from 'node:path';
import { DEFAULT_HOST, DEFAULT_PORT } from './defaults.js';
import { messages } from './messages.js';

/** Sign-in with one outside provider. */
export interface OAuthClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Object storage, from the environment. */
export interface StorageConfig {
  readonly endpoint: string;
  readonly publicEndpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
}

/**
 * The install's default provider for the assistant (the five
 * `TURNKEEL_ASSISTANT_` variables). It turns nothing on: a workspace uses it only after
 * an Owner or Admin chose it and turned the assistant on there.
 */
export interface InstallAssistant {
  readonly provider: AssistantProvider;
  readonly baseUrl: string;
  readonly model: string;
  /** Never stored, shown, logged, or sent to any address but `baseUrl`. */
  readonly apiKey: string | null;
}

/**
 * The server's configuration, read from the environment and from nothing else.
 * `signIn` is null in local mode without sign-in.
 */
export interface Config {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string | null;
  readonly databaseUrlDirect: string | null;
  readonly dataDir: string;
  readonly signIn: {
    /** `TURNKEEL_PUBLIC_URL`, without a slash at the end. */
    readonly publicUrl: string;
    readonly authSecret: string;
    readonly openSignup: boolean;
    readonly github: OAuthClient | null;
    readonly google: OAuthClient | null;
  } | null;
  readonly secretsKey: string | null;
  readonly mail: { readonly smtpUrl: string; readonly from: string } | null;
  readonly storage: StorageConfig | null;
  readonly maxFileBytes: number;
  /**
   * `TURNKEEL_TRUSTED_PROXIES`: the addresses and ranges of the reverse proxies in
   * front of the server. Only a request that arrives from one of them is believed
   * about the client's address (`X-Forwarded-For`). Empty unless set.
   */
  readonly trustedProxies: readonly string[];
  /**
   * The assistant's install-wide settings. `default` is null when the variables are not
   * set, and on a server with open sign-up, where no workspace is offered it.
   * `dailyCap` is `TURNKEEL_ASSISTANT_DAILY_CAP`: all the workspaces that use the default
   * make, together, no more calls a day.
   */
  readonly assistant: { readonly default: InstallAssistant | null; readonly dailyCap: number };
  /**
   * `TURNKEEL_DEMO`: whether local mode loads the demo workspace on its first run. False
   * unless set to `true`, which `turnkeel --demo` does: the first run starts
   * empty, with one question. Never read with
   * sign-in on, where no demo loads.
   */
  readonly demo: boolean;
  /** Things worth saying at start that do not stop it. */
  readonly notices: readonly string[];
}

export const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024;

/** The shortest `TURNKEEL_AUTH_SECRET` the server takes. */
export const MIN_AUTH_SECRET_LENGTH = 32;

/** The shortest `TURNKEEL_SECRETS_KEY` the server takes, as for `TURNKEEL_AUTH_SECRET`. */
export const MIN_SECRETS_KEY_LENGTH = 32;

/** The configuration cannot be used. `problems` has one sentence for each variable that is wrong. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super([messages.config.cannotStart, ...problems.map((problem) => `- ${problem}`)].join('\n'));
    this.problems = problems;
  }
}

export type Environment = Readonly<Record<string, string | undefined>>;

const localModeHosts = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * True for the addresses local mode listens on: `127.0.0.1`, `localhost` and `::1`.
 *
 * These are the loopback addresses that a request can reach under a name R33 allows:
 * `127.0.0.1`, `localhost` or a name under `.localhost`, which browsers resolve as they
 * resolve `localhost`. Any other address of 127.0.0.0/8 is loopback too, but none of
 * those names leads to it, so a server bound there would start and then refuse every
 * request.
 */
export function isLocalModeHost(host: string): boolean {
  return localModeHosts.has(host.toLowerCase());
}

/**
 * Reads and checks the configuration. Throws `ConfigError`, naming every variable
 * that is missing, half set or not usable, so one start shows all of them.
 */
export function loadConfig(env: Environment = process.env): Config {
  const problems: string[] = [];
  const notices: string[] = [];
  const m = messages.config;

  /** A variable's value, or null when it is not set or empty. */
  const read = (name: string): string | null => {
    const value = env[name]?.trim();
    return value ? value : null;
  };

  const bool = (name: string): boolean => {
    const value = read(name);
    if (value === null) return false;
    if (value === 'true') return true;
    if (value === 'false') return false;
    problems.push(m.notBoolean(name));
    return false;
  };

  const httpUrl = (name: string, options: { bare?: boolean } = {}): string | null => {
    const value = read(name);
    if (value === null) return null;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      problems.push(m.notUrl(name));
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      problems.push(m.notUrl(name));
      return null;
    }
    if (options.bare && (url.pathname !== '/' || url.search !== '' || url.hash !== '')) {
      problems.push(m.urlWithPath(name));
      return null;
    }
    return options.bare ? url.origin : value.replace(/\/+$/, '');
  };

  // --- Address ---------------------------------------------------------------
  const publicUrl = httpUrl('TURNKEEL_PUBLIC_URL', { bare: true });
  const publicUrlSet = read('TURNKEEL_PUBLIC_URL') !== null;
  // `[::1]` is how a URL writes the address; a socket is bound to `::1`.
  const hostText = read('TURNKEEL_HOST') ?? DEFAULT_HOST;
  const host = /^\[.*\]$/.test(hostText) ? hostText.slice(1, -1) : hostText;

  let port = DEFAULT_PORT;
  const portText = read('TURNKEEL_PORT');
  if (portText !== null) {
    const parsed = Number(portText);
    if (/^\d+$/.test(portText) && parsed >= 1 && parsed <= 65535) port = parsed;
    else problems.push(m.notPort('TURNKEEL_PORT'));
  }

  // R29: without sign-in the server listens on the loopback address only.
  if (!publicUrlSet && !isLocalModeHost(host)) problems.push(m.notLocalHost);

  // --- Database ----------------------------------------------------------------
  const postgresUrl = (name: string): string | null => {
    const value = read(name);
    if (value === null) return null;
    if (!/^postgres(?:ql)?:\/\//i.test(value)) {
      problems.push(m.notPostgresUrl(name));
      return null;
    }
    return value;
  };
  const databaseUrl = postgresUrl('DATABASE_URL');
  const databaseUrlDirect = postgresUrl('DATABASE_URL_DIRECT');
  if (read('DATABASE_URL_DIRECT') !== null && read('DATABASE_URL') === null) {
    problems.push(m.needs('DATABASE_URL_DIRECT', 'DATABASE_URL'));
  }
  const dataDir = path.resolve(read('TURNKEEL_DATA_DIR') ?? path.join(os.homedir(), '.turnkeel'));

  // --- Sign-in -------------------------------------------------------------------
  const authSecret = read('TURNKEEL_AUTH_SECRET');
  if (publicUrlSet) {
    if (authSecret === null) problems.push(m.authSecretMissing);
    else if (authSecret.length < MIN_AUTH_SECRET_LENGTH) {
      problems.push(m.authSecretShort(MIN_AUTH_SECRET_LENGTH));
    }
  }

  // --- Stored secrets ---------------------------------------------------------------
  const secretsKey = read('TURNKEEL_SECRETS_KEY');
  if (secretsKey !== null && secretsKey.length < MIN_SECRETS_KEY_LENGTH) {
    problems.push(m.secretsKeyShort(MIN_SECRETS_KEY_LENGTH));
  }

  const oauth = (idName: string, secretName: string): OAuthClient | null => {
    const clientId = read(idName);
    const clientSecret = read(secretName);
    if (clientId === null && clientSecret === null) return null;
    if (clientId === null) problems.push(m.halfSet(secretName, idName));
    if (clientSecret === null) problems.push(m.halfSet(idName, secretName));
    if (clientId === null || clientSecret === null) return null;
    if (!publicUrlSet) notices.push(m.unusedWithoutSignIn(idName));
    return { clientId, clientSecret };
  };
  const github = oauth('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET');
  const google = oauth('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');

  const openSignup = bool('TURNKEEL_OPEN_SIGNUP');
  const demo = read('TURNKEEL_DEMO') === null ? false : bool('TURNKEEL_DEMO');
  if (read('TURNKEEL_DEMO') !== null && publicUrlSet) notices.push(m.demoWithSignIn);
  if (openSignup && !publicUrlSet) notices.push(m.unusedWithoutSignIn('TURNKEEL_OPEN_SIGNUP'));

  const trustedProxies = (read('TURNKEEL_TRUSTED_PROXIES') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (trustedProxies.some((entry) => parseTrustedProxy(entry) === null)) {
    problems.push(m.notProxyList('TURNKEEL_TRUSTED_PROXIES'));
  }
  if (trustedProxies.length > 0 && !publicUrlSet) {
    notices.push(m.unusedWithoutSignIn('TURNKEEL_TRUSTED_PROXIES'));
  }

  // --- Mail ----------------------------------------------------------------------
  const smtpUrl = read('SMTP_URL');
  const mailFrom = read('MAIL_FROM');
  if (smtpUrl !== null && !/^smtps?:\/\//i.test(smtpUrl)) problems.push(m.notSmtpUrl('SMTP_URL'));
  if (smtpUrl !== null && mailFrom === null) problems.push(m.halfSet('SMTP_URL', 'MAIL_FROM'));
  if (smtpUrl === null && mailFrom !== null) problems.push(m.halfSet('MAIL_FROM', 'SMTP_URL'));

  // --- Files -----------------------------------------------------------------------
  const s3Endpoint = httpUrl('S3_ENDPOINT');
  const s3PublicEndpoint = httpUrl('S3_PUBLIC_ENDPOINT');
  const s3Required = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const s3Optional = ['S3_PUBLIC_ENDPOINT', 'S3_FORCE_PATH_STYLE'];
  const forcePathStyle = bool('S3_FORCE_PATH_STYLE');
  if (read('S3_ENDPOINT') !== null) {
    for (const name of s3Required) {
      if (read(name) === null) problems.push(m.halfSet('S3_ENDPOINT', name));
    }
  } else {
    for (const name of [...s3Required, ...s3Optional]) {
      if (read(name) !== null) problems.push(m.halfSet(name, 'S3_ENDPOINT'));
    }
  }

  let maxFileBytes = DEFAULT_MAX_FILE_BYTES;
  const maxFileText = read('TURNKEEL_MAX_FILE_BYTES');
  if (maxFileText !== null) {
    const parsed = Number(maxFileText);
    if (/^\d+$/.test(maxFileText) && Number.isSafeInteger(parsed) && parsed > 0) {
      maxFileBytes = parsed;
    } else {
      problems.push(m.notPositiveInteger('TURNKEEL_MAX_FILE_BYTES'));
    }
  }

  // --- The assistant ------------------------------------------------------------------
  // The check looks at the shape of the values, looks no name up and makes no request:
  // nothing reaches a model host at start.
  const assistantNames = [
    'TURNKEEL_ASSISTANT_PROVIDER',
    'TURNKEEL_ASSISTANT_BASE_URL',
    'TURNKEEL_ASSISTANT_MODEL',
    'TURNKEEL_ASSISTANT_API_KEY',
    'TURNKEEL_ASSISTANT_DAILY_CAP',
  ];
  let installAssistant: InstallAssistant | null = null;
  let assistantDailyCap = DEFAULT_DAILY_CAP;
  const openSignupInEffect = openSignup && publicUrlSet;
  if (openSignupInEffect && assistantNames.some((name) => read(name) !== null)) {
    // R70: with open sign-up the five have no effect, and do not stop the start.
    notices.push(m.assistantOpenSignup);
  } else {
    const providerText = read('TURNKEEL_ASSISTANT_PROVIDER');
    const baseUrlText = read('TURNKEEL_ASSISTANT_BASE_URL');
    const modelText = read('TURNKEEL_ASSISTANT_MODEL');
    const apiKey = read('TURNKEEL_ASSISTANT_API_KEY');
    const capText = read('TURNKEEL_ASSISTANT_DAILY_CAP');
    if (capText !== null) {
      const parsed = Number(capText);
      if (/^\d+$/.test(capText) && parsed >= 1 && parsed <= 10_000) assistantDailyCap = parsed;
      else problems.push(m.assistantDailyCap);
    }
    if (providerText === null) {
      // Any of the other four without the provider is half set, the daily cap too.
      for (const name of assistantNames.slice(1)) {
        if (read(name) !== null) problems.push(m.assistantNeedsProvider(name));
      }
    } else if (providerText !== 'anthropic' && providerText !== 'openai-compatible') {
      problems.push(m.assistantProvider);
    } else {
      const provider: AssistantProvider = providerText;
      let baseUrl: string | null =
        baseUrlText ?? (provider === 'anthropic' ? 'https://api.anthropic.com' : null);
      if (baseUrl === null)
        problems.push(m.assistantNeeds(provider, 'TURNKEEL_ASSISTANT_BASE_URL'));
      else {
        // The environment may name a local address.
        const normalised = normaliseBaseUrl(baseUrl);
        if (normalised === null || !baseUrlTextAllowed(normalised, { localAllowed: true })) {
          problems.push(m.assistantBaseUrl);
          baseUrl = null;
        } else baseUrl = normalised;
      }
      if (modelText === null) problems.push(m.assistantNeeds(provider, 'TURNKEEL_ASSISTANT_MODEL'));
      else if (!assistantModelSchema.safeParse(modelText).success) problems.push(m.assistantModel);
      if (provider === 'anthropic' && apiKey === null) {
        problems.push(m.assistantNeeds(provider, 'TURNKEEL_ASSISTANT_API_KEY'));
      }
      if (baseUrl !== null && modelText !== null) {
        installAssistant = { provider, baseUrl, model: modelText, apiKey };
      }
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    host,
    port,
    databaseUrl,
    databaseUrlDirect,
    dataDir,
    signIn:
      publicUrl !== null && authSecret !== null
        ? { publicUrl, authSecret, openSignup, github, google }
        : null,
    secretsKey,
    mail: smtpUrl !== null && mailFrom !== null ? { smtpUrl, from: mailFrom } : null,
    storage:
      s3Endpoint !== null
        ? {
            endpoint: s3Endpoint,
            publicEndpoint: s3PublicEndpoint ?? s3Endpoint,
            bucket: read('S3_BUCKET') ?? '',
            region: read('S3_REGION') ?? '',
            accessKeyId: read('S3_ACCESS_KEY_ID') ?? '',
            secretAccessKey: read('S3_SECRET_ACCESS_KEY') ?? '',
            forcePathStyle,
          }
        : null,
    maxFileBytes,
    trustedProxies,
    assistant: { default: installAssistant, dailyCap: assistantDailyCap },
    demo,
    notices,
  };
}
