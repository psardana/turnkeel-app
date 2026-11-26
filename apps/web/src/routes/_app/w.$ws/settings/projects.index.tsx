import { createFileRoute } from '@tanstack/react-router';
import { ProjectsPage } from '@/features/projects/projects-page';

export const Route = createFileRoute('/_app/w/$ws/settings/projects/')({
  validateSearch: (search: Record<string, unknown>): { archived?: boolean } =>
    search.archived === true || search.archived === 'true' ? { archived: true } : {},
  component: ProjectsPage,
});
