import { z } from 'zod';

/** Every object's `id` is a UUID. */
export const idSchema = z.uuid();

export type Id = z.infer<typeof idSchema>;

/** A time as it travels in JSON: ISO 8601 in UTC, such as `2026-11-11T09:30:00.000Z`. */
export const timestampSchema = z.iso.datetime();

export type Timestamp = z.infer<typeof timestampSchema>;

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The slug of a workspace or a project: lower-case letters, digits and single hyphens.
 * Slugs are compared without regard to case, so a route may carry `Acme` for `acme`;
 * what is stored is always lower case.
 */
export const slugSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(slugPattern, 'Use lower-case letters, digits and single hyphens.');

export type Slug = z.infer<typeof slugSchema>;

/** A project key: 2 to 6 letters, kept in upper case. Card numbers start with it (`APP-12`). */
export const projectKeySchema = z
  .string()
  .regex(/^[A-Za-z]{2,6}$/, 'Use 2 to 6 letters.')
  .transform((key) => key.toUpperCase());

export type ProjectKey = z.infer<typeof projectKeySchema>;

/** A person's handle in a workspace, written `@handle`: lower-case letters, digits and hyphens. */
export const handleSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(slugPattern, 'Use lower-case letters, digits and single hyphens.');

export type Handle = z.infer<typeof handleSchema>;

/** An email address. Addresses are compared without regard to case and kept in lower case. */
export const emailSchema = z
  .email()
  .max(254)
  .transform((email) => email.toLowerCase());

/** A three-letter currency code, such as `EUR`. */
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code.');

/** A language tag, such as `en` or `pt-BR`. */
export const localeSchema = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'Use a language tag such as en or pt-BR.');

export type DateOnly = z.infer<typeof dateSchema>;
