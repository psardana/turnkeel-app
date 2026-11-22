import { handleSchema } from '@turnkeel/protocol';

/** How many numbered forms of a handle are tried before giving up. */
const MAX_TRIES = 50;

/** Text as a handle: lower-case letters, digits and single hyphens, 2 to 32 characters. Null when nothing usable is left. */
export function toHandle(text: string): string | null {
  const handle = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return handleSchema.safeParse(handle).success ? handle : null;
}

/**
 * A free handle made from a person's name, or from the part of their email address
 * before the `@` when the name gives none. `isTaken` says whether
 * someone in the workspace has a handle. Null when no free one was found.
 */
export async function suggestHandle(
  person: { name: string; email: string },
  isTaken: (handle: string) => Promise<boolean>,
): Promise<string | null> {
  const base = toHandle(person.name) ?? toHandle(person.email.split('@')[0] ?? '');
  if (base === null) return null;
  if (!(await isTaken(base))) return base;
  for (let number = 2; number <= MAX_TRIES; number += 1) {
    const suffix = `-${number}`;
    const candidate = `${base.slice(0, 32 - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (handleSchema.safeParse(candidate).success && !(await isTaken(candidate))) return candidate;
  }
  return null;
}
