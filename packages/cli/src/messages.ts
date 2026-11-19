/** "GBP", "GBP and JPY", "CHF, GBP and JPY". */
const andList = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** Every line the command prints. English only; all strings go through here. */
/** Where stored readings show: Money, Posts and Analytics, or Analytics' App section. */
export type SignalsPlace = 'money' | 'posts' | 'analytics';

export const messages = {
  version: (version: string) => `turnkeel ${version}`,
  unknownCommand: (command: string) => `turnkeel does not have the command "${command}".`,
} as const;
