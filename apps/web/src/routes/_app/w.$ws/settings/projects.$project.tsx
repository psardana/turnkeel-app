import { createFileRoute } from '@tanstack/react-router';
import { EditProjectPage } from '@/features/projects/project-form-page';

export const Route = createFileRoute('/_app/w/$ws/settings/projects/$project')({
  component: EditProjectPage,
});
