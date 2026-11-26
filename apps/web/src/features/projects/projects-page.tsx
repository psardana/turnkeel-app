import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/features/session/session';
import { formatDate } from '@/lib/dates';
import { projectsQuery } from '@/lib/queries';
import { messages } from '@/messages';

const route = getRouteApi('/_app/w/$ws/settings/projects/');

/** The projects of the workspace. Whether archived ones show is part of the URL. */
export function ProjectsPage() {
  const workspace = useWorkspace();
  const { archived = false } = route.useSearch();
  const navigate = route.useNavigate();
  const projects = useQuery(projectsQuery(workspace.slug, archived));
  const mayCreate = workspace.abilities.createProject;

  const newProject = mayCreate ? (
    <Button asChild>
      <Link to="/w/$ws/settings/projects/new" params={{ ws: workspace.slug }}>
        <PlusIcon aria-hidden="true" />
        {messages.projects.new}
      </Link>
    </Button>
  ) : null;

  return (
    <section>
      <PageHeader
        title={messages.projects.title}
        intro={messages.projects.intro}
        actions={newProject}
      />

      <label className="mb-4 flex w-fit cursor-pointer items-center gap-2" data-touch>
        <Checkbox
          checked={archived}
          onCheckedChange={(checked) =>
            void navigate({ search: checked === true ? { archived: true } : {} })
          }
        />
        {messages.projects.showArchived}
      </label>

      {projects.isPending ? (
        <LoadingState />
      ) : projects.isError ? (
        <ErrorState
          what={messages.projects.what}
          error={projects.error}
          onRetry={() => void projects.refetch()}
        />
      ) : projects.data.length === 0 ? (
        <EmptyState title={messages.projects.emptyTitle} action={newProject}>
          {mayCreate ? messages.projects.emptyBody : messages.projects.emptyBodyReadOnly}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b text-small text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold first:pl-0">
                  {messages.projects.columns.name}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold first:pl-0">
                  {messages.projects.columns.key}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold max-sm:hidden">
                  {messages.projects.columns.kind}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold max-sm:hidden">
                  {messages.projects.columns.locales}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold first:pl-0">
                  {messages.projects.columns.launchDate}
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.data.map((project) => (
                <tr key={project.id} className="border-b">
                  <th scope="row" className="py-1.5 pr-3 font-normal">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                      <Link
                        to="/w/$ws/settings/projects/$project"
                        params={{ ws: workspace.slug, project: project.key }}
                        className="link flex min-h-8 items-center font-medium"
                        data-touch
                      >
                        {project.name}
                      </Link>
                      {project.archivedAt ? <Badge>{messages.projects.archivedBadge}</Badge> : null}
                    </span>
                  </th>
                  <td className="px-3 py-1.5 font-mono text-meta text-muted-foreground">
                    {project.key}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground max-sm:hidden">
                    {messages.projects.kind(project.kind)}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground max-sm:hidden">
                    {project.locales.join(', ')}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                    {project.launchDate
                      ? formatDate(project.launchDate)
                      : messages.projects.noLaunchDate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
