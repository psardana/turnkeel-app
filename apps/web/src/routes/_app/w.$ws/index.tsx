import { createFileRoute, redirect } from '@tanstack/react-router';
import { EmptyState } from '@/components/states';
import { useWorkspace } from '@/features/session/session';
import { messages } from '@/messages';
import { workspaceHome } from '@/navigation';

/**
 * A workspace opens on the first view the person's role allows. The choice is made
 * before the route loads, so it is made again on every visit.
 */
export const Route = createFileRoute('/_app/w/$ws/')({
  beforeLoad: async ({ context, params }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    const entry = me?.workspaces.find(
      (candidate) => candidate.workspace.slug === params.ws.toLowerCase(),
    );
    // Not a workspace of this person: the layout says that nothing is here.
    if (!me || !entry) return;
    const home = workspaceHome(abilitiesIn(me, entry.workspace.id));
    if (home) {
      throw redirect({ to: home.to, params: { ws: entry.workspace.slug }, replace: true });
    }
  },
  component: NothingToShow,
});

/** A role that opens no view this version has, such as a Tester before Testing is built. */
function NothingToShow() {
  const workspace = useWorkspace();
  const onlyTester =
    workspace.entry.role === null &&
    Object.values(workspace.entry.projectRoles).every((role) => role === 'tester');
  return (
    <EmptyState title={messages.workspace.nothingHereTitle}>
      {onlyTester ? messages.workspace.testerBody : messages.workspace.noAccessBody}
    </EmptyState>
  );
}
