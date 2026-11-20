import { z } from 'zod';
import { idSchema } from './ids.js';

/** Who can act: a person, an agent or the system. */
export const principalKinds = ['user', 'agent', 'system'] as const;

export type PrincipalKind = (typeof principalKinds)[number];

/**
 * The id the system carries where a principal is named. The system is a job or a
 * connector and has no row of its own, so every install uses this one id for it.
 */
export const SYSTEM_PRINCIPAL_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Names one principal: `{ kind, id }`. This is what `createdBy` and `updatedBy` hold.
 * It differs from a ref (ref.ts), which can name a party and cannot name the system.
 */
export const principalRefSchema = z.strictObject({
  kind: z.enum(principalKinds),
  id: idSchema,
});

export type PrincipalRef = z.infer<typeof principalRefSchema>;

/** The system, as a principal ref. */
export const systemPrincipalRef: PrincipalRef = { kind: 'system', id: SYSTEM_PRINCIPAL_ID };

/**
 * The actor of an event: a principal with the name it had when it acted.
 * `name` is a person's display name, an agent's name, or "System".
 */
export const actorSchema = z.strictObject({
  kind: z.enum(principalKinds),
  id: idSchema,
  name: z.string(),
});

export type Actor = z.infer<typeof actorSchema>;
