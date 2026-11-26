import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  DISPLAY_NAME_MAX,
  acceptInvitationResponseSchema,
  handleSchema,
  invitationLookupSchema,
  type InvitationLookup,
} from '@turnkeel/protocol';
import { useState, type FormEvent } from 'react';
import { Field, FormError } from '@/components/form';
import { CenteredPage, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlainHeader } from '@/features/sign-in/sign-in-page';
import { SignInMethods } from '@/features/sign-in/sign-in-methods';
import { api, isNotFound } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { formatDateTime } from '@/lib/dates';
import { refusal } from '@/lib/form-errors';
import { keys, meQuery, serverQuery } from '@/lib/queries';
import { handleFrom } from '@/lib/slug';
import { messages } from '@/messages';

/** The token as the link carries it, read from the address itself so that no parsing changes it. */
function tokenFromAddress(): string | null {
  const token = new URLSearchParams(window.location.search).get('token');
  return token === null || token === '' ? null : token;
}

function Invalid({ body }: { body: string }) {
  return (
    <>
      <h1 className="text-title">{messages.invitation.invalidTitle}</h1>
      <p className="mt-2 text-muted-foreground">{body}</p>
    </>
  );
}

function Summary({ invitation }: { invitation: InvitationLookup }) {
  const sentence =
    invitation.project === null
      ? messages.invitation.toWorkspace({
          inviter: invitation.invitedBy.name,
          workspace: invitation.workspace.name,
          role: invitation.role,
        })
      : messages.invitation.toProject({
          inviter: invitation.invitedBy.name,
          workspace: invitation.workspace.name,
          project: invitation.project.name,
          role: invitation.role,
        });
  return (
    <div className="mb-6 grid gap-2">
      <h1 className="text-title">{messages.invitation.title}</h1>
      <p>{sentence}</p>
      <p className="text-muted-foreground">
        {messages.invitation.expires(formatDateTime(invitation.expiresAt))}
      </p>
    </div>
  );
}

function AcceptForm({
  token,
  invitation,
  askName,
}: {
  token: string;
  invitation: InvitationLookup;
  /** True for an account that has no display name yet, which a new one never has. */
  askName: boolean;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toWorkspace = invitation.project === null;
  const [yourName, setYourName] = useState('');
  const [handle, setHandle] = useState(invitation.suggestedHandle ?? '');
  const [handleTouched, setHandleTouched] = useState(false);
  const [handleError, setHandleError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: async () => {
      if (askName && yourName.trim() !== '') {
        await authClient.updateUser({ name: yourName.trim() });
      }
      return api('POST', '/invitations/accept', acceptInvitationResponseSchema, {
        body: { token, ...(toWorkspace && handle.trim() !== '' ? { handle: handle.trim() } : {}) },
      });
    },
    onSuccess: async (joined) => {
      await queryClient.refetchQueries({ queryKey: keys.me });
      await navigate({ to: '/w/$ws', params: { ws: joined.workspace.slug } });
    },
    onError: (error) => {
      const { field, message } = refusal(error);
      if (field === 'handle') setHandleError(message);
      else setFormError(message);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setHandleError(undefined);
    if (toWorkspace && handle.trim() !== '' && !handleSchema.safeParse(handle.trim()).success) {
      setHandleError(messages.validation.handle);
      return;
    }
    accept.mutate();
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      {askName ? (
        <Field label={messages.welcome.yourNameLabel}>
          {(control) => (
            <Input
              {...control}
              name="name"
              autoComplete="name"
              maxLength={DISPLAY_NAME_MAX}
              value={yourName}
              onChange={(event) => {
                setYourName(event.target.value);
                if (toWorkspace && !handleTouched) setHandle(handleFrom(event.target.value));
              }}
            />
          )}
        </Field>
      ) : null}
      {toWorkspace ? (
        <Field
          label={messages.welcome.handleLabel}
          hint={messages.welcome.handleHint}
          error={handleError}
        >
          {(control) => (
            <Input
              {...control}
              name="handle"
              autoCapitalize="none"
              spellCheck={false}
              value={handle}
              onChange={(event) => {
                setHandle(event.target.value);
                setHandleTouched(true);
              }}
            />
          )}
        </Field>
      ) : null}
      <FormError message={formError} />
      <div>
        <Button type="submit" pending={accept.isPending}>
          {messages.invitation.accept}
        </Button>
      </div>
    </form>
  );
}

/**
 * The page an invitation link opens. It says who invited the person to
 * what, opens sign-in for the invited address, and accepts once they are signed in
 * with it.
 */
export function AcceptInvitationPage() {
  const server = useSuspenseQuery(serverQuery).data;
  const queryClient = useQueryClient();
  const [token] = useState(tokenFromAddress);
  const me = useQuery({ ...meQuery, enabled: server.mode === 'server' });
  const signedInAs = me.data?.user.email ?? null;

  const lookup = useQuery({
    // Read again once the person is signed in: the answer then carries a free handle.
    queryKey: ['invitation', token, signedInAs],
    queryFn: ({ signal }) =>
      api('POST', '/invitations/lookup', invitationLookupSchema, { body: { token }, signal }),
    enabled: token !== null && server.mode === 'server' && !me.isPending,
    retry: false,
    staleTime: Infinity,
  });

  let body;
  if (server.mode === 'local') {
    body = <Invalid body={messages.invitation.localMode} />;
  } else if (token === null) {
    body = <Invalid body={messages.invitation.missingToken} />;
  } else if (me.isPending || lookup.isPending) {
    body = <LoadingState />;
  } else if (me.isError) {
    body = (
      <ErrorState
        what={messages.invitation.title}
        error={me.error}
        onRetry={() => void me.refetch()}
      />
    );
  } else if (lookup.isError) {
    body = isNotFound(lookup.error) ? (
      <Invalid body={messages.invitation.invalidBody} />
    ) : (
      <ErrorState
        what={messages.invitation.title}
        error={lookup.error}
        onRetry={() => void lookup.refetch()}
      />
    );
  } else if (signedInAs === null) {
    const here = `${window.location.pathname}${window.location.search}`;
    body = (
      <>
        <Summary invitation={lookup.data} />
        <p className="mb-4 text-muted-foreground">
          {messages.invitation.sentTo(lookup.data.email)}
        </p>
        <SignInMethods server={server} next={here} email={lookup.data.email} />
      </>
    );
  } else if (signedInAs !== lookup.data.email) {
    body = (
      <>
        <Summary invitation={lookup.data} />
        <p className="mb-4">
          {messages.invitation.wrongAccount({ signedIn: signedInAs, invited: lookup.data.email })}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            void authClient.signOut().then(() => {
              clearDrafts(me.data?.user.id ?? null);
              queryClient.clear();
              window.location.reload();
            });
          }}
        >
          {messages.nav.signOut}
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <Summary invitation={lookup.data} />
        <AcceptForm
          token={token}
          invitation={lookup.data}
          askName={(me.data?.user.name ?? '').trim() === ''}
        />
      </>
    );
  }

  return (
    <CenteredPage>
      <PlainHeader />
      {body}
    </CenteredPage>
  );
}
