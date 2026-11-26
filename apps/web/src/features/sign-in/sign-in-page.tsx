import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { Brand } from '@/components/brand';
import { FormError } from '@/components/form';
import { CenteredPage } from '@/components/states';
import { ThemeSwitch } from '@/components/theme';
import { Button } from '@/components/ui/button';
import { keys, serverQuery } from '@/lib/queries';
import { messages } from '@/messages';
import { SignInMethods } from './sign-in-methods';

const route = getRouteApi('/sign-in');

/**
 * Where to go after signing in. Only a path of this app is taken, never another site.
 *
 * The value comes from the address bar, so it is read the way the browser will read
 * it and not by how it starts: a browser takes a backslash for a slash and drops tabs
 * and line breaks, which turns `/\host` and `/<tab>/host` into addresses of another
 * site. What is returned is the path, query and fragment of the resolved address.
 */
export function safeNext(next: string | undefined): string {
  if (next === undefined || !next.startsWith('/')) return '/';
  // Nothing this app links to has a backslash or a control character in it.
  if (/[\\\p{Cc}]/u.test(next)) return '/';
  let url: URL;
  try {
    url = new URL(next, window.location.origin);
  } catch {
    return '/';
  }
  if (url.origin !== window.location.origin) return '/';
  if (url.pathname === '/sign-in' || url.pathname.startsWith('/sign-in/')) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}

/** What Better Auth's `error` value on the way back means, as a sentence. */
export function signInError(code: string | undefined): string | null {
  if (code === undefined || code === '') return null;
  if (code === 'signup_by_invitation') return messages.signIn.invitationOnly;
  if (code === 'INVALID_TOKEN' || code === 'EXPIRED_TOKEN') return messages.signIn.linkInvalid;
  return messages.signIn.failed;
}

/** The top of every page that has no app header: the name and the theme switch. */
export function PlainHeader() {
  return (
    <div className="mb-8 flex items-center justify-between">
      <Brand />
      <ThemeSwitch />
    </div>
  );
}

export function SignInPage() {
  const server = useSuspenseQuery(serverQuery).data;
  const search = route.useSearch();
  const queryClient = useQueryClient();

  if (server.mode === 'local') {
    // Local mode has no sign-in page: the one-time address lands in the app.
    return (
      <CenteredPage>
        <PlainHeader />
        <h1 className="text-title">{messages.signIn.localTitle}</h1>
        <p className="mt-2 text-muted-foreground">{messages.signIn.localBody}</p>
        <div className="mt-4">
          <Button
            variant="outline"
            onClick={() => {
              queryClient.removeQueries({ queryKey: keys.me });
              window.location.assign(safeNext(search.next));
            }}
          >
            {messages.signIn.localRetry}
          </Button>
        </div>
      </CenteredPage>
    );
  }

  return (
    <CenteredPage>
      <PlainHeader />
      <h1 className="mb-6 text-title">{messages.signIn.title}</h1>
      <div className="mb-4 empty:hidden">
        <FormError message={signInError(search.error)} />
      </div>
      <SignInMethods server={server} next={safeNext(search.next)} />
      {server.openSignup ? (
        <p className="mt-6 text-meta text-muted-foreground">{messages.signIn.openSignup}</p>
      ) : null}
    </CenteredPage>
  );
}
