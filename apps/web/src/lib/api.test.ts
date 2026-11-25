import { errorBody, serverInfoSchema } from '@turnkeel/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from '@/messages';
import { api, ApiError, apiVoid, errorMessage, isForbidden, isNotFound } from './api';

const answer = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

function serve(response: Response | Error) {
  const fetchMock = vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const caught = async (run: Promise<unknown>): Promise<ApiError> => {
  try {
    await run;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('The request did not fail.');
};

afterEach(() => vi.unstubAllGlobals());

const info = {
  mode: 'server',
  signIn: { magicLink: true, github: false, google: false, passkey: true },
  mail: 'log',
  openSignup: false,
};

describe('api', () => {
  it('sends JSON to /api/v1 with the session cookie and returns the checked answer', async () => {
    const fetchMock = serve(answer(200, info));
    const result = await api('POST', '/server', serverInfoSchema, { body: { a: 1 } });
    expect(result.mail).toBe('log');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/server');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.body).toBe('{"a":1}');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  });

  it("turns a refusal into an error with the server's sentence, its rule and the request id", async () => {
    serve(
      answer(403, errorBody('forbidden', 'Only an Owner can give the Owner role.', 'R31'), {
        'X-Request-Id': 'req-1',
      }),
    );
    const error = await caught(apiVoid('PATCH', '/workspaces/acme/members/x', { body: {} }));
    expect(error.status).toBe(403);
    expect(error.code).toBe('forbidden');
    expect(error.rule).toBe('R31');
    expect(error.requestId).toBe('req-1');
    expect(errorMessage(error)).toBe('Only an Owner can give the Owner role.');
    expect(isForbidden(error)).toBe(true);
    expect(isNotFound(error)).toBe(false);
  });

  it('keeps the code that says which field a 409 is about', async () => {
    serve(answer(409, errorBody('key_taken', 'Another project has this key.')));
    const error = await caught(apiVoid('POST', '/workspaces/acme/projects', { body: {} }));
    expect(error.code).toBe('key_taken');
  });

  it('still says something when an error has no body it can read', async () => {
    serve(new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = await caught(apiVoid('GET', '/me'));
    expect(error.status).toBe(502);
    expect(error.code).toBe('internal');
    expect(error.message).toBe(messages.errors.status(502));
  });

  it('says that the server did not answer when the request never arrives', async () => {
    serve(new TypeError('Failed to fetch'));
    const error = await caught(apiVoid('GET', '/me'));
    expect(error.status).toBe(0);
    expect(error.code).toBe('network');
    expect(error.message).toBe(messages.errors.network);
  });

  it('refuses an answer that does not have the shape the protocol gives it', async () => {
    serve(answer(200, { ...info, mail: 'pigeon' }));
    const error = await caught(api('GET', '/server', serverInfoSchema));
    expect(error.code).toBe('bad_response');
  });

  it('takes an answer without a body', async () => {
    serve(new Response(null, { status: 204 }));
    await expect(apiVoid('DELETE', '/workspaces/acme/members/x')).resolves.toBeUndefined();
  });

  it('has a sentence for anything else that is thrown', () => {
    expect(errorMessage(new Error('boom'))).toBe(messages.errors.unexpected);
  });
});
