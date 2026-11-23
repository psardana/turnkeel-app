import { unprocessableIssue } from '@turnkeel/protocol';
import type { Context } from 'hono';
import type { z } from 'zod';
import { messages } from '../messages.js';
import { HttpError } from './errors.js';

function detail(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return '';
  const where = issue.path.map(String).join('.');
  return where ? `${where}: ${issue.message}` : issue.message;
}

/** The JSON a request carries, or `{}` when it has no body. Throws 400 when the body is not JSON. */
export async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError('bad_request', messages.errors.badJson);
  }
}

/**
 * Checks a body against its schema from `@turnkeel/protocol`. Throws 400 when it does
 * not match, and 422 when its only fault is a text with characters it may not hold,
 * such as a control character in a card's body: the request has the right shape and
 * cannot be applied.
 */
export function parseBody<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const refusedText = result.error.issues.every((issue) => unprocessableIssue(issue));
    throw new HttpError(
      refusedText ? 'unprocessable' : 'bad_request',
      messages.errors.badBody(detail(result.error)),
    );
  }
  return result.data;
}

/** Checks the query string against its schema. Throws 400 when it does not match. */
export function parseQuery<Schema extends z.ZodType>(schema: Schema, c: Context): z.output<Schema> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    throw new HttpError('bad_request', messages.errors.badQuery(detail(result.error)));
  }
  return result.data;
}
