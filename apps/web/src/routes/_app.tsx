import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { SessionContext } from '@/features/session/session';
import { meQuery, serverQuery } from '@/lib/queries';

/**
 * Every page that needs a person. Without one the browser goes to the sign-in page,
 * which in local mode says how to get in.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const [, me] = await Promise.all([
      context.queryClient.ensureQueryData(serverQuery),
      context.queryClient.ensureQueryData(meQuery),
    ]);
    if (me === null) throw redirect({ to: '/sign-in', search: { next: location.href } });
  },
  component: SignedIn,
});

function SignedIn() {
  const server = useSuspenseQuery(serverQuery).data;
  const me = useQuery(meQuery).data;
  // The session ended while the page was open.
  if (!me) return <SessionEnded />;
  return (
    <SessionContext value={{ me, server }}>
      <Outlet />
    </SessionContext>
  );
}
