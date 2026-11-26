import { createFileRoute } from '@tanstack/react-router';
import { NewWorkspacePage } from '@/features/workspaces/welcome-page';

export const Route = createFileRoute('/_app/workspaces/new')({
  component: NewWorkspacePage,
});
