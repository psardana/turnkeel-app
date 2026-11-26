import { eventAreas, idSchema, type EventArea } from '@turnkeel/protocol';
import { isDateOnly } from '@/lib/dates';

/**
 * The filters of the Activity view as the URL holds them: the project by
 * its key, the area, the actor by id, and a range of days in the viewer's time zone.
 */
export interface ActivitySearch {
  project?: string;
  area?: EventArea;
  actor?: string;
  from?: string;
  to?: string;
}

/** Reads the filters from the URL. A value that does not fit is left out, never an error. */
export function parseActivitySearch(search: Record<string, unknown>): ActivitySearch {
  const result: ActivitySearch = {};
  if (typeof search.project === 'string' && /^[A-Za-z]{2,6}$/.test(search.project)) {
    result.project = search.project.toUpperCase();
  }
  if (typeof search.area === 'string' && (eventAreas as readonly string[]).includes(search.area)) {
    result.area = search.area as EventArea;
  }
  if (idSchema.safeParse(search.actor).success) result.actor = search.actor as string;
  if (isDateOnly(search.from)) result.from = search.from;
  if (isDateOnly(search.to)) result.to = search.to;
  return result;
}

export const hasFilters = (search: ActivitySearch) => Object.keys(search).length > 0;
