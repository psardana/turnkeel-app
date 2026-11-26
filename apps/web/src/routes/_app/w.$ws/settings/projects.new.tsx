import { createFileRoute } from '@tanstack/react-router';
import { NewProjectPage } from '@/features/projects/project-form-page';

export const Route = createFileRoute('/_app/w/$ws/settings/projects/new')({
  component: NewProjectPage,
});
