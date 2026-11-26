import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * `/`, where sign-in and the logo lead: the first-run page for a person
 * in no workspace, the home page for one with more than one workspace or project, and
 * the one workspace's first view for anyone else.
 */
export const Route = createFileRoute('/_app/')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (me === null) throw redirect({ to: '/sign-in' });
    let projects: number | null = null;
    const only = me.workspaces.length === 1 ? me.workspaces[0] : undefined;
    if (only) {
      try {
        projects = (await context.queryClient.ensureQueryData(projectsQuery(only.workspace.slug)))
          .length;
      } catch {
        // Without the list the workspace opens, as it did before the home page.
      }
    }
    const landing = landingOf(me, projects);
    if (landing.to === '/w/$ws') throw redirect({ to: landing.to, params: { ws: landing.ws } });
    throw redirect({ to: landing.to });
  },
});
