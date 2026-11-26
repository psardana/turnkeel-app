import { compose } from './servers.ts';

/**
 * Reads mail from the mail catcher of docker compose (Mailpit) through its API. A
 * test finds its own mail by the address it was sent to, so mail that other people
 * left in the catcher is not touched.
 */
interface Summary {
  ID: string;
  Subject: string;
  Created: string;
}

async function search(to: string): Promise<Summary[]> {
  const query = encodeURIComponent(`to:"${to}"`);
  const response = await fetch(`${compose.mailApi}/api/v1/search?query=${query}`);
  if (!response.ok) throw new Error(`The mail catcher answered ${response.status}.`);
  const body = (await response.json()) as { messages?: Summary[] };
  return body.messages ?? [];
}

/**
 * Waits for a mail to `to` whose subject contains `subject`, and returns the first
 * link in its text. `known` holds the ids of mail that was read already.
 */
export async function linkFromMail(
  to: string,
  subject: string,
  known: Set<string> = new Set(),
  timeoutMs = 60_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = (await search(to)).find(
      (message) => message.Subject.includes(subject) && !known.has(message.ID),
    );
    if (found) {
      known.add(found.ID);
      const response = await fetch(`${compose.mailApi}/api/v1/message/${found.ID}`);
      const message = (await response.json()) as { Text?: string };
      const link = /https?:\/\/\S+/.exec(message.Text ?? '')?.[0];
      if (!link) throw new Error(`The mail "${found.Subject}" to ${to} has no link.`);
      return link;
    }
    if (Date.now() > deadline) {
      throw new Error(`No mail with "${subject}" arrived for ${to} within ${timeoutMs} ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
