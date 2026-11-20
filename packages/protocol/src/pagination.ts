import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** How many items a list returns at most. A query string carries it as text, so it is coerced. */
export const pageLimitSchema = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE);

/**
 * The query of a paged list. `cursor` is the `nextCursor` of the page before; a
 * client never builds one itself.
 */
export const pageQuerySchema = z.strictObject({
  limit: pageLimitSchema.default(DEFAULT_PAGE_SIZE),
  cursor: z.string().min(1).max(200).optional(),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

/** One page of a list. `nextCursor` is null on the last page. */
export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.strictObject({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export interface Page<Item> {
  items: Item[];
  nextCursor: string | null;
}
