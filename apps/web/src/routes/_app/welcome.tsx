import { createFileRoute, redirect } from '@tanstack/react-router';
import { WelcomePage } from '@/features/workspaces/welcome-page';

/** First run: a person who is in no workspace yet. */
export const Route = createFileRoute('/_app/welcome')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    // Not a first run after all.
    if (me && me.workspaces.length > 0) throw redirect({ to: '/', replace: true });
  },
  component: WelcomePage,
});
