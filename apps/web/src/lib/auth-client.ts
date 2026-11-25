import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/client';
import { magicLinkClient } from 'better-auth/client/plugins';

/**
 * The browser side of sign-in. The server's sign-in routes are Better Auth's
 * (`/api/auth/*`) and answer in its own shape, which this client reads.
 * It is used only on a server with sign-in; local mode has none.
 */
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [magicLinkClient(), passkeyClient()],
});

/**
 * The sentence of a failed call, when Better Auth sent one. A call that was refused
 * because too many came from this address (429) gets the app's own sentence.
 */
export function authErrorMessage(
  error: { message?: string | undefined; status?: number | undefined } | null,
): string | null {
  if (error?.status === 429) return messages.signIn.tooMany;
  return error?.message && error.message.trim() !== '' ? error.message : null;
}
