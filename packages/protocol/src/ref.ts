import { z } from 'zod';

/** What a ref can name: a person, an agent or a party. */
export const refKinds = ['user', 'agent', 'party'] as const;

export type RefKind = (typeof refKinds)[number];

/** A ref is `{ kind, id }`. It names one person, agent or party. */
export const refSchema = z.strictObject({
  kind: z.enum(refKinds),
  id: z.uuid(),
});

export type Ref = z.infer<typeof refSchema>;
