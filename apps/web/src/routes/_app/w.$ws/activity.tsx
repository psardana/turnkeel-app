import { createFileRoute } from '@tanstack/react-router';
import { ActivityPage } from '@/features/activity/activity-page';
import { parseActivitySearch } from '@/features/activity/search';

/** The Activity view. Its filters are part of the URL. */
export const Route = createFileRoute('/_app/w/$ws/activity')({
  validateSearch: parseActivitySearch,
  component: ActivityPage,
});
