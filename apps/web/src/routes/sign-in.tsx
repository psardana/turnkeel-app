import { createFileRoute, redirect } from '@tanstack/react-router';
import { safeNext, SignInPage } from '@/features/sign-in/sign-in-page';
import { meQuery, serverQuery } from '@/lib/queries';

/**
 * The sign-in page. It shows the methods the server says are configured and no
 * others. In local mode it says how to get in instead.
 */
export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>): { next?: string; error?: string } => ({
    ...(typeof search.next === 'string' ? { next: search.next } : {}),
    ...(typeof search.error === 'string' ? { error: search.error } : {}),
  }),
  beforeLoad: async ({ context, search }) => {
    const [, me] = await Promise.all([
      context.queryClient.ensureQueryData(serverQuery),
      context.queryClient.fetchQuery(meQuery),
    ]);
    if (me !== null) throw redirect({ href: safeNext(search.next) });
  },
  component: SignInPage,
});
