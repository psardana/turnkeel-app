import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { AppFrame } from '@/components/app-header';
import { NotFound } from '@/components/route-states';
import {
  rememberWorkspace,
  useSession,
  WorkspaceContext,
  type WorkspaceSession,
} from '@/features/session/session';
import { StreamStateContext, useWorkspaceStream } from '@/features/stream/use-workspace-stream';
import { abilitiesIn } from '@/lib/permissions';

/** Everything inside one workspace: the shell, and the one live stream of this tab. */
export const Route = createFileRoute('/_app/w/$ws')({
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  const { ws } = Route.useParams();
  const { me } = useSession();
  const entry = me.workspaces.find((candidate) => candidate.workspace.slug === ws.toLowerCase());
  const workspace = useMemo<WorkspaceSession | null>(
    () =>
      entry
        ? { entry, slug: entry.workspace.slug, abilities: abilitiesIn(me, entry.workspace.id) }
        : null,
    [entry, me],
  );

  // A workspace that does not exist and one the person is not in look the same.
  if (!workspace) {
    return (
      <AppFrame>
        <NotFound />
      </AppFrame>
    );
  }
  return <OpenWorkspace workspace={workspace} />;
}

function OpenWorkspace({ workspace }: { workspace: WorkspaceSession }) {
  const stream = useWorkspaceStream(workspace.slug);
  useEffect(() => rememberWorkspace(workspace.slug), [workspace.slug]);
  const path = useRouterState({ select: (state) => state.location.pathname });
  // A Tester sees only Testing: any other address in the workspace is the one 404 for
  // them, the same answer as an address that names nothing.
  const hidden = workspace.abilities.onlyTester && !testerMayOpen(path, workspace.slug);
  // A view an Owner or Admin turned off says so in place of its
  // page; a Tester's Testing shows whatever is set. On a person's first visit to a view,
  // its intro shows above it until they press Got it. A section of Ship or Marketing, or a
  // page of Reference, is framed under its bar of sections, by its own layout.
  const view = viewOfPath(path, workspace.slug);
  return (
    <WorkspaceContext value={workspace}>
      <StreamStateContext value={stream}>
        <AppFrame>
          {hidden ? (
            <NotFound />
          ) : view !== null && inSectionBar(view) ? (
            <Outlet />
          ) : (
            <ViewFrame view={view}>
              <Outlet />
            </ViewFrame>
          )}
        </AppFrame>
      </StreamStateContext>
    </WorkspaceContext>
  );
}
