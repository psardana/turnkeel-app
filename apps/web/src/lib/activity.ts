import type { Event } from '@turnkeel/protocol';
import { dayKey } from './dates';

/**
 * The event types of which a run shows as one line in the Activity view: the saves of
 * one note by one person. The notes arrive with Testing and Review;
 * the names are here already so that the rule is built and tested once.
 */
export const collapsibleTypes: ReadonlySet<string> = new Set(['step.noted', 'asset.noted']);

/** One line of the Activity view: one event, or a run of the same kind of event. */
export interface ActivityRow {
  /** Stable while the run grows: the `seq` of its oldest event. */
  key: string;
  /** The events of the row, newest first. */
  events: Event[];
  /** The newest event, which is the one the line describes. */
  latest: Event;
  count: number;
}

const sameRun = (a: Event, b: Event) =>
  a.type === b.type &&
  a.actor.kind === b.actor.kind &&
  a.actor.id === b.actor.id &&
  a.subject.type === b.subject.type &&
  a.subject.id === b.subject.id;

/** Events from several pages as one list: each `seq` once, newest first. */
export function mergeEvents(pages: readonly (readonly Event[])[]): Event[] {
  const bySeq = new Map<number, Event>();
  for (const page of pages) {
    for (const event of page) bySeq.set(event.seq, event);
  }
  return [...bySeq.values()].sort((a, b) => b.seq - a.seq);
}

/**
 * Turns events (newest first) into lines. Events that follow each other, are of the
 * same collapsible type, by the same actor and about the same item become one line.
 * An event of another kind in between ends the run.
 */
export function collapseRuns(
  events: readonly Event[],
  isCollapsible: (type: string) => boolean = (type) => collapsibleTypes.has(type),
): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const event of events) {
    const last = rows.at(-1);
    const previous = last?.events.at(-1);
    if (last && previous && isCollapsible(event.type) && sameRun(previous, event)) {
      last.events.push(event);
      last.count += 1;
      last.key = String(event.seq);
    } else {
      rows.push({ key: String(event.seq), events: [event], latest: event, count: 1 });
    }
  }
  return rows;
}

export interface ActivityDay {
  /** The viewer's calendar day, as `2026-11-11`. */
  day: string;
  rows: ActivityRow[];
}

/** Lines grouped by the viewer's calendar day, newest day first. */
export function groupByDay(rows: readonly ActivityRow[], timeZone?: string): ActivityDay[] {
  const days: ActivityDay[] = [];
  for (const row of rows) {
    const day = dayKey(row.latest.at, timeZone);
    const last = days.at(-1);
    if (last && last.day === day) last.rows.push(row);
    else days.push({ day, rows: [row] });
  }
  return days;
}

/** The people, agents and the system that the loaded events name, for the actor filter. */
export function actorsOf(events: readonly Event[]): { id: string; name: string; kind: string }[] {
  const byId = new Map<string, { id: string; name: string; kind: string }>();
  for (const event of events) {
    if (!byId.has(event.actor.id)) {
      byId.set(event.actor.id, {
        id: event.actor.id,
        name: event.actor.name,
        kind: event.actor.kind,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
