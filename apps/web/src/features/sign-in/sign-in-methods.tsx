import type { ServerInfo } from '@turnkeel/protocol';
import { KeyRoundIcon, MailCheckIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Field, FormError } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient, authErrorMessage } from '@/lib/auth-client';
import { messages } from '@/messages';

/**
 * The ways to sign in that this server has configured, and no others:
 * a link by mail always, GitHub and Google when set up, and a passkey for a person
 * who has added one.
 */
export function SignInMethods({
  server,
  next,
  email: fixedEmail,
}: {
  server: ServerInfo;
  /** Where to go after signing in: a path of this app. */
  next: string;
  /** Set on the invitation page, where the address is the invited one. */
  email?: string;
}) {
  const [email, setEmail] = useState(fixedEmail ?? '');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState<'link' | 'passkey' | 'github' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const errorUrl = `/sign-in?next=${encodeURIComponent(next)}`;

  const sendLink = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (address === '') return;
    setPending('link');
    setError(null);
    const result = await authClient.signIn.magicLink({
      email: address,
      callbackURL: next,
      errorCallbackURL: errorUrl,
    });
    setPending(null);
    if (result.error) setError(authErrorMessage(result.error) ?? messages.signIn.failed);
    else setSentTo(address);
  };

  const withProvider = async (provider: 'github' | 'google') => {
    setPending(provider);
    setError(null);
    const result = await authClient.signIn.social({
      provider,
      callbackURL: next,
      errorCallbackURL: errorUrl,
    });
    // On success the browser is on its way to the provider.
    if (result.error) {
      setPending(null);
      setError(authErrorMessage(result.error) ?? messages.signIn.failed);
    }
  };

  const withPasskey = async () => {
    setPending('passkey');
    setError(null);
    const result = await authClient.signIn.passkey();
    if (result.error) {
      setPending(null);
      setError(authErrorMessage(result.error) ?? messages.signIn.passkeyFailed);
      return;
    }
    window.location.assign(next);
  };

  if (sentTo !== null) {
    return (
      <div className="grid gap-3" role="status">
        <h2 className="flex items-center gap-2 text-body font-semibold">
          <MailCheckIcon className="size-4 text-primary" aria-hidden="true" />
          {messages.signIn.linkSentTitle}
        </h2>
        <p className="text-muted-foreground">{messages.signIn.linkSent(sentTo)}</p>
        {server.mail === 'log' ? <p>{messages.signIn.mailNotConfigured}</p> : null}
        {fixedEmail === undefined ? (
          <div>
            <Button variant="outline" onClick={() => setSentTo(null)}>
              {messages.signIn.useOtherAddress}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const others = server.signIn.github || server.signIn.google || server.signIn.passkey;

  return (
    <div className="grid gap-4">
      {server.signIn.magicLink ? (
        <form onSubmit={(event) => void sendLink(event)} className="grid gap-3" noValidate>
          <Field label={messages.signIn.emailLabel}>
            {(control) => (
              <Input
                {...control}
                type="email"
                name="email"
                autoComplete="email webauthn"
                inputMode="email"
                required
                readOnly={fixedEmail !== undefined}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          {server.mail === 'log' ? (
            <p className="text-muted-foreground">{messages.signIn.mailNotConfigured}</p>
          ) : null}
          <Button
            type="submit"
            pending={pending === 'link'}
            disabled={(pending !== null && pending !== 'link') || email.trim() === ''}
          >
            {messages.signIn.sendLink}
          </Button>
        </form>
      ) : null}

      {others ? (
        <>
          <div
            className="flex items-center gap-3 text-meta text-muted-foreground"
            aria-hidden="true"
          >
            <span className="h-px flex-1 bg-border" />
            {messages.signIn.or}
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="grid gap-2">
            {server.signIn.passkey ? (
              <Button
                variant="outline"
                disabled={pending !== null}
                onClick={() => void withPasskey()}
              >
                <KeyRoundIcon aria-hidden="true" />
                {messages.signIn.passkey}
              </Button>
            ) : null}
            {server.signIn.github ? (
              <Button
                variant="outline"
                disabled={pending !== null}
                onClick={() => void withProvider('github')}
              >
                {messages.signIn.github}
              </Button>
            ) : null}
            {server.signIn.google ? (
              <Button
                variant="outline"
                disabled={pending !== null}
                onClick={() => void withProvider('google')}
              >
                {messages.signIn.google}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      <FormError message={error} />
    </div>
  );
}
