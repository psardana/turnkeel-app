import { z } from 'zod';

/** How mail leaves the server: through SMTP, or into the server log. */
export const mailKinds = ['smtp', 'log'] as const;

export type MailKind = (typeof mailKinds)[number];

/**
 * `GET /server`: what this server offers, for the sign-in page. It needs no sign-in
 * and holds nothing secret. `mode` is `local` without sign-in and `server`
 * with it. Each sign-in method is true only when it is configured.
 */
export const serverInfoSchema = z.strictObject({
  mode: z.enum(['local', 'server']),
  signIn: z.strictObject({
    magicLink: z.boolean(),
    github: z.boolean(),
    google: z.boolean(),
    passkey: z.boolean(),
  }),
  mail: z.enum(mailKinds),
  openSignup: z.boolean(),
});

export type ServerInfo = z.infer<typeof serverInfoSchema>;
