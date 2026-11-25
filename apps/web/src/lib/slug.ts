/** Suggestions made from a name while a form is filled in. The person can change each. */

/** `Harbor App!` becomes `harbor-app`: lower-case letters, digits and single hyphens, at most 40. */
export function slugFrom(name: string, max = 40): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** A handle from a person's name: the same shape as a slug, at most 32. */
export const handleFrom = (name: string) => slugFrom(name, 32);

/** `Harbor App` becomes `HA`, `Harbor` becomes `HAR`: 2 to 6 letters. */
export function keyFrom(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[^A-Za-z ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  const letters =
    words.length === 1 ? (words[0] ?? '').slice(0, 3) : words.map((word) => word[0]).join('');
  return letters.slice(0, 6).toUpperCase();
}
