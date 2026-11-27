import type { ServerInfo } from '@turnkeel/protocol';
import { messages } from '@/messages';

/** The outside sign-in providers this server has turned on, by the name people know them by. */
export function providersOf(server: ServerInfo): string[] {
  return [
    ...(server.signIn.github ? [messages.signIn.githubName] : []),
    ...(server.signIn.google ? [messages.signIn.googleName] : []),
  ];
}

/**
 * Says that sign-in with GitHub or Google has not been run against the real provider.
 * It shows only on a server that has one of them turned on, which is
 * where an operator needs to know it.
 */
export function UnverifiedSignInNote({ server }: { server: ServerInfo }) {
  const providers = providersOf(server);
  if (providers.length === 0) return null;
  return (
    <section className="mt-8 max-w-md" aria-labelledby="unverified-sign-in">
      <h2 id="unverified-sign-in" className="text-body font-semibold">
        {messages.workspace.signInTitle}
      </h2>
      <p className="mt-2 text-muted-foreground">
        {messages.workspace.providersUnverified(providers)}
      </p>
    </section>
  );
}
