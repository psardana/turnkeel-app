import { errorBodySchema, type ErrorCode } from '@turnkeel/protocol';
import { messages } from '@/messages';

/** Every REST route of the server starts with this. */
export const API_BASE = '/api/v1';

/** What went wrong with a request that the server did not answer with a code of its own. */
export type ClientErrorCode = 'network' | 'bad_response';

/**
 * A request that failed. `message` is a sentence to show: the server's own when it
 * sent one, and one from the catalogue otherwise.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  /** The HTTP status, or 0 when no answer arrived. */
  readonly status: number;
  readonly code: ErrorCode | ClientErrorCode;
  /** The rule the server named, such as `R31`. */
  readonly rule: string | undefined;
  /** The server's id for the request, which its log and its events carry too. */
  readonly requestId: string | undefined;
  /**
   * The whole body of the error answer, for an answer that carries more than the error,
   * such as the `current` card beside a 409 `rev_mismatch`.
   */
  readonly body: unknown;

  constructor(input: {
    status: number;
    code: ErrorCode | ClientErrorCode;
    message: string;
    rule?: string | undefined;
    requestId?: string | undefined;
    body?: unknown;
  }) {
    super(input.message);
    this.status = input.status;
    this.code = input.code;
    this.rule = input.rule;
    this.requestId = input.requestId;
    this.body = input.body;
  }
}

/** True for the answer the server gives when the caller may not do the action. */
export function isForbidden(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403;
}

export function isNotFound(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 404;
}

export function isUnauthorized(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401;
}

/** The sentence to show for anything a request can throw. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return messages.errors.unexpected;
}

const fallbackCodes: Record<number, ErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  422: 'unprocessable',
  429: 'too_many_requests',
};

/** The error of an answer, which may carry more beside it (`current` of a 409). */
const errorAnswerSchema = z.object({ error: errorBodySchema.shape.error });

async function failure(response: Response): Promise<ApiError> {
  const requestId = response.headers.get('X-Request-Id') ?? undefined;
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = undefined;
  }
  const body = errorAnswerSchema.safeParse(parsed);
  if (body.success) {
    return new ApiError({
      status: response.status,
      code: body.data.error.code,
      message: body.data.error.message,
      rule: body.data.error.rule,
      requestId,
      body: parsed,
    });
  }
  return new ApiError({
    status: response.status,
    code: fallbackCodes[response.status] ?? 'internal',
    message: messages.errors.status(response.status),
    requestId,
  });
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal | undefined;
  /** Sent as `Idempotency-Key`, so that a retry of a POST does nothing twice. */
  idempotencyKey?: string | undefined;
}

/**
 * Makes a request and gives back the answer when it is a success, for an answer that is
 * read as it arrives, such as a draft of the assistant. Throws `ApiError` otherwise.
 */
export function apiResponse(
  method: Method,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  return send(method, path, options);
}

async function send(method: Method, path: string, options: RequestOptions): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.idempotencyKey === undefined
          ? {}
          : { 'Idempotency-Key': options.idempotencyKey }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({ status: 0, code: 'network', message: messages.errors.network });
  }
  if (!response.ok) throw await failure(response);
  return response;
}

/**
 * Calls a REST route and checks the answer against its schema from
 * `@turnkeel/protocol`, so the types the app works with are the ones the server sent.
 */
export async function api<Schema extends z.ZodType>(
  method: Method,
  path: string,
  schema: Schema,
  options: RequestOptions = {},
): Promise<z.output<Schema>> {
  const response = await send(method, path, options);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError({
      status: response.status,
      code: 'bad_response',
      message: messages.errors.badResponse,
      requestId: response.headers.get('X-Request-Id') ?? undefined,
    });
  }
  return parsed.data;
}

/** Calls a REST route whose answer carries nothing the app reads, such as a 204. */
export async function apiVoid(
  method: Method,
  path: string,
  options: RequestOptions = {},
): Promise<void> {
  await send(method, path, options);
}

/** A path segment, safe to put into a URL. */
export const seg = (value: string) => encodeURIComponent(value);
