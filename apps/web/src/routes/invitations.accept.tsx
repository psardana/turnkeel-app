import { createFileRoute } from '@tanstack/react-router';
import { AcceptInvitationPage } from '@/features/invitations/accept-page';

/** `<public URL>/invitations/accept?token=<token>`: the page an invitation mail links to. */
export const Route = createFileRoute('/invitations/accept')({
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    typeof search.token === 'string' && search.token !== '' ? { token: search.token } : {},
  component: AcceptInvitationPage,
});
