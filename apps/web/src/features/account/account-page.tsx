import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DISPLAY_NAME_MAX, handleSchema, memberSchema, type MyWorkspace } from '@turnkeel/protocol';
import { KeyRoundIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { AppFrame } from '@/components/app-header';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, errorMessage, seg } from '@/lib/api';
import { authClient, authErrorMessage } from '@/lib/auth-client';
import { formatDateTime } from '@/lib/dates';
import { keys } from '@/lib/queries';
import { messages } from '@/messages';

function NameForm() {
  const { me } = useSession();
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.user.name);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (next: string) => {
      const result = await authClient.updateUser({ name: next });
      if (result.error)
        throw new Error(authErrorMessage(result.error) ?? messages.errors.unexpected);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
      toast.success(messages.common.saved);
    },
    onError: (failure) => setError(failure.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (name.trim() === '') {
      setError(messages.validation.required);
      return;
    }
    // Nothing has changed: Save writes nothing.
    if (name.trim() === me.user.name) {
      toast.success(messages.common.saved);
      return;
    }
    save.mutate(name.trim());
  };

  return (
    <form onSubmit={submit} className="grid max-w-md gap-4" noValidate>
      <Field label={messages.account.nameLabel} hint={messages.account.nameHint}>
        {(control) => (
          <Input
            {...control}
            name="name"
            autoComplete="name"
            maxLength={DISPLAY_NAME_MAX}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <Field label={messages.account.emailLabel}>
        {(control) => <Input {...control} value={me.user.email} readOnly />}
      </Field>
      <FormError message={error} />
      <div>
        <Button type="submit" pending={save.isPending}>
          {messages.common.save}
        </Button>
      </div>
    </form>
  );
}

/** A person changes their own handle, and nobody else's. */
function HandleForm({ entry }: { entry: MyWorkspace }) {
  const { me } = useSession();
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState(entry.handle ?? '');
  const [error, setError] = useState<string | undefined>();

  const save = useMutation({
    mutationFn: (next: string) =>
      api(
        'PATCH',
        `/workspaces/${seg(entry.workspace.slug)}/members/${seg(me.user.id)}`,
        memberSchema,
        { body: { handle: next } },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
      await queryClient.invalidateQueries({ queryKey: keys.members(entry.workspace.slug) });
      toast.success(messages.common.saved);
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = handleSchema.safeParse(handle.trim());
    if (!parsed.success) {
      setError(messages.validation.handle);
      return;
    }
    setError(undefined);
    if (parsed.data === entry.handle) {
      toast.success(messages.common.saved);
      return;
    }
    save.mutate(parsed.data);
  };

  return (
    <form onSubmit={submit} className="flex max-w-md items-end gap-2" noValidate>
      <Field
        label={messages.account.handleLabel(entry.workspace.name)}
        error={error}
        className="flex-1"
      >
        {(control) => (
          <Input
            {...control}
            name="handle"
            autoCapitalize="none"
            spellCheck={false}
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
          />
        )}
      </Field>
      <Button
        type="submit"
        variant="outline"
        className={error ? 'mb-5' : undefined}
        pending={save.isPending}
      >
        {messages.common.save}
      </Button>
    </form>
  );
}

interface PasskeyRow {
  id: string;
  name?: string | null | undefined;
  createdAt?: string | Date | null | undefined;
}

/** Passkeys are added here, after a first sign-in by another method. */
function Passkeys() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PasskeyRow | null>(null);
  const supported = typeof window.PublicKeyCredential === 'function';

  const passkeys = useQuery({
    queryKey: keys.passkeys,
    queryFn: async (): Promise<PasskeyRow[]> => {
      const result = await authClient.passkey.listUserPasskeys();
      if (result.error)
        throw new Error(authErrorMessage(result.error) ?? messages.errors.unexpected);
      return result.data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async (passkeyName: string) => {
      const result = await authClient.passkey.addPasskey(
        passkeyName === '' ? undefined : { name: passkeyName },
      );
      if (result?.error) {
        throw new Error(authErrorMessage(result.error) ?? messages.account.passkeyFailed);
      }
    },
    onSuccess: async () => {
      setName('');
      await queryClient.invalidateQueries({ queryKey: keys.passkeys });
      toast.success(messages.account.passkeyAdded);
    },
    onError: (failure) => setError(failure.message),
  });

  const remove = useMutation({
    mutationFn: async (passkey: PasskeyRow) => {
      const result = await authClient.passkey.deletePasskey({ id: passkey.id });
      if (result.error)
        throw new Error(authErrorMessage(result.error) ?? messages.errors.unexpected);
    },
    onSuccess: async () => {
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: keys.passkeys });
      toast.success(messages.account.passkeyRemoved);
    },
    onError: (failure) => {
      setRemoving(null);
      toastFailure(failure.message);
    },
  });

  const label = (passkey: PasskeyRow) => passkey.name || messages.account.passkeyUnnamed;

  return (
    <section aria-labelledby="passkeys" className="grid max-w-md gap-3">
      <div>
        <h2 id="passkeys" className="text-body font-semibold">
          {messages.account.passkeysTitle}
        </h2>
        <p className="mt-1 text-muted-foreground">{messages.account.passkeysIntro}</p>
      </div>
      {passkeys.isPending ? (
        <LoadingState className="py-2" />
      ) : passkeys.isError ? (
        <ErrorState
          what={messages.account.passkeysWhat}
          error={passkeys.error}
          onRetry={() => void passkeys.refetch()}
        />
      ) : passkeys.data.length === 0 ? (
        <p className="text-muted-foreground">{messages.account.noPasskeys}</p>
      ) : (
        <ul className="border-t">
          {passkeys.data.map((passkey) => (
            <li key={passkey.id} className="flex items-center gap-3 border-b py-2">
              <KeyRoundIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{label(passkey)}</p>
                {passkey.createdAt ? (
                  <p className="text-meta text-muted-foreground">
                    {messages.account.passkeyAddedOn(formatDateTime(passkey.createdAt))}
                  </p>
                ) : null}
              </div>
              <Button
                variant="outline"
                aria-label={messages.account.removePasskeyLabel(label(passkey))}
                onClick={() => setRemoving(passkey)}
              >
                {messages.common.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            add.mutate(name.trim());
          }}
        >
          <Field
            label={messages.account.passkeyNameLabel}
            hint={messages.account.passkeyNameHint}
            optional
            className="flex-1"
          >
            {(control) => (
              <Input
                {...control}
                name="passkeyName"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="outline" className="mb-5" disabled={add.isPending}>
            {add.isPending ? messages.account.adding : messages.account.addPasskey}
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground">{messages.account.passkeysUnsupported}</p>
      )}
      <FormError message={error} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={removing ? messages.account.removePasskeyTitle(label(removing)) : ''}
        confirmLabel={messages.common.remove}
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing);
        }}
      >
        {messages.account.removePasskeyBody}
      </ConfirmDialog>
    </section>
  );
}

/** Account settings: the display name, the handle in each workspace, and passkeys. */
export function AccountPage() {
  const { me, server } = useSession();
  const withHandle = me.workspaces.filter((entry) => entry.handle !== null);
  const signIn = server.mode === 'server';
  // The page is also Settings, Profile, inside the workspace's own frame.
  const inWorkspace = useOptionalWorkspace() !== null;

  const page = (
    <>
      {/* In Settings the page carries its section's name, Profile. */}
      <PageHeader
        title={inWorkspace ? messages.settings.profileTitle : messages.account.title}
        intro={inWorkspace ? messages.settings.profileIntro : messages.account.intro}
      />
      <div className="grid gap-8">
        {signIn ? <NameForm /> : <Notice>{messages.account.localNote}</Notice>}

        <section aria-labelledby="handles" className="grid gap-3">
          <div>
            <h2 id="handles" className="text-body font-semibold">
              {messages.account.handlesTitle}
            </h2>
            <p className="mt-1 text-muted-foreground">{messages.account.handlesIntro}</p>
          </div>
          {withHandle.length === 0 ? (
            <p className="text-muted-foreground">{messages.account.noHandles}</p>
          ) : (
            withHandle.map((entry) => <HandleForm key={entry.workspace.id} entry={entry} />)
          )}
        </section>

        {signIn && server.signIn.passkey ? <Passkeys /> : null}
      </div>
    </>
  );
  return inWorkspace ? <section>{page}</section> : <AppFrame>{page}</AppFrame>;
}
