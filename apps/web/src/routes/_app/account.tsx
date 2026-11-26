import { createFileRoute, Navigate } from '@tanstack/react-router';
import { AccountPage } from '@/features/account/account-page';

/**
 * `/account`: the account page is Settings, Profile, so the old address
 * leads there, in the workspace `/` would open. Someone in no workspace, or
 * only a Tester in it, who has no Settings, keeps the page here.
 */
export const Route = createFileRoute('/_app/account')({
  component: AccountRoute,
});

function AccountRoute() {
  const { me } = useSession();
  const slug = accountWorkspace(me);
  if (slug === null) return <AccountPage />;
  return <Navigate to="/w/$ws/settings/profile" params={{ ws: slug }} replace />;
}
