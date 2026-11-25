import type { z } from 'zod';
import { ApiError, errorMessage } from './api';

/** The first problem of each field, as the sentence the catalogue has for it. */
export function fieldErrors<Field extends string>(
  error: z.ZodError,
  sentences: Partial<Record<Field, string>>,
  fallback: string,
): Partial<Record<Field, string>> {
  const found: Partial<Record<Field, string>> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '') as Field;
    if (found[field] === undefined) found[field] = sentences[field] ?? fallback;
  }
  return found;
}

/** Which field a refused write is about, when the server's code says so. */
const codeFields: Record<string, string> = {
  slug_taken: 'slug',
  key_taken: 'key',
  handle_taken: 'handle',
};

/**
 * Splits a failed write into the field it belongs to and the sentence to show. A 403
 * or anything else that is about no single field belongs to the form as a whole.
 */
export function refusal(error: unknown): { field: string | null; message: string } {
  const field = error instanceof ApiError ? (codeFields[error.code] ?? null) : null;
  return { field, message: errorMessage(error) };
}
