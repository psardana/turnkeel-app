import { createFileRoute } from '@tanstack/react-router';

/** The home of Settings: every section with one line each. */
export const Route = createFileRoute('/_app/w/$ws/settings/')({
  component: SettingsHome,
});
