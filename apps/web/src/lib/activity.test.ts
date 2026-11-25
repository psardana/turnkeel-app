import { describe, expect, it } from 'vitest';
import { ADA, eventOf, NOTE, OTHER_NOTE } from '@/testing/events';
import { actorsOf, collapseRuns, collapsibleTypes, groupByDay, mergeEvents } from './activity';

describe('collapseRuns', () => {
  it('shows a run of saves on one note by one person as one line', () => {
    const events = [
      eventOf(5, 'step.noted'),
      eventOf(4, 'step.noted'),
      eventOf(3, 'step.noted'),
      eventOf(2, 'project.created'),
      eventOf(1, 'workspace.created'),
    ];
    const rows = collapseRuns(events);
    expect(rows.map((row) => [row.latest.seq, row.count])).toEqual([
      [5, 3],
      [2, 1],
      [1, 1],
    ]);
    expect(rows[0]?.events.map((event) => event.seq)).toEqual([5, 4, 3]);
  });

  it('describes the line by its newest event and keys it by its oldest', () => {
    const [row] = collapseRuns([eventOf(9, 'asset.noted'), eventOf(8, 'asset.noted')]);
    expect(row?.latest.seq).toBe(9);
    expect(row?.key).toBe('8');
  });

  it('keeps the key of a run when a newer save joins it, so the line is not drawn anew', () => {
    const before = collapseRuns([eventOf(4, 'step.noted'), eventOf(3, 'step.noted')]);
    const after = collapseRuns([
      eventOf(5, 'step.noted'),
      eventOf(4, 'step.noted'),
      eventOf(3, 'step.noted'),
    ]);
    expect(after[0]?.key).toBe(before[0]?.key);
    expect(after[0]?.count).toBe(3);
  });

  it('does not join saves by another person', () => {
    const rows = collapseRuns([
      eventOf(3, 'step.noted'),
      eventOf(2, 'step.noted', { actor: ADA }),
      eventOf(1, 'step.noted'),
    ]);
    expect(rows.map((row) => row.count)).toEqual([1, 1, 1]);
  });

  it('does not join saves on another note', () => {
    const rows = collapseRuns([
      eventOf(2, 'step.noted', { subject: NOTE }),
      eventOf(1, 'step.noted', { subject: OTHER_NOTE }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('ends a run when another kind of event lies between', () => {
    const rows = collapseRuns([
      eventOf(3, 'step.noted'),
      eventOf(2, 'project.updated'),
      eventOf(1, 'step.noted'),
    ]);
    expect(rows.map((row) => row.count)).toEqual([1, 1, 1]);
  });

  it('never joins events that are not saves of a note', () => {
    const rows = collapseRuns([
      eventOf(3, 'project.updated'),
      eventOf(2, 'project.updated'),
      eventOf(1, 'project.updated'),
    ]);
    expect(rows).toHaveLength(3);
    expect([...collapsibleTypes].sort()).toEqual(['asset.noted', 'step.noted']);
  });

  it('gives no line for no events', () => {
    expect(collapseRuns([])).toEqual([]);
  });
});

describe('mergeEvents', () => {
  it('makes one list of several pages, each seq once, newest first', () => {
    const merged = mergeEvents([
      [eventOf(5, 'project.created'), eventOf(4, 'project.updated')],
      [eventOf(4, 'project.updated'), eventOf(2, 'workspace.created')],
      [eventOf(6, 'project.archived')],
    ]);
    expect(merged.map((event) => event.seq)).toEqual([6, 5, 4, 2]);
  });
});

describe('groupByDay', () => {
  it("groups lines by the viewer's calendar day, not by the UTC day", () => {
    const rows = collapseRuns([
      eventOf(3, 'project.created', { at: '2026-11-11T01:30:00.000Z' }),
      eventOf(2, 'project.created', { at: '2026-11-10T23:30:00.000Z' }),
      eventOf(1, 'project.created', { at: '2026-11-10T09:00:00.000Z' }),
    ]);
    expect(groupByDay(rows, 'UTC').map((day) => [day.day, day.rows.length])).toEqual([
      ['2026-11-11', 1],
      ['2026-11-10', 2],
    ]);
    // In Los Angeles the first two fall on 10 November.
    expect(
      groupByDay(rows, 'America/Los_Angeles').map((day) => [day.day, day.rows.length]),
    ).toEqual([['2026-11-10', 3]]);
    // In Tokyo the last two fall on different days than in UTC.
    expect(groupByDay(rows, 'Asia/Tokyo').map((day) => [day.day, day.rows.length])).toEqual([
      ['2026-11-11', 2],
      ['2026-11-10', 1],
    ]);
  });
});

describe('actorsOf', () => {
  it('names each actor of the loaded events once, by name', () => {
    const actors = actorsOf([
      eventOf(3, 'project.created'),
      eventOf(2, 'project.created', { actor: ADA }),
      eventOf(1, 'project.created'),
    ]);
    expect(actors.map((actor) => actor.name)).toEqual(['Ada Admin', 'Olive Owner']);
  });
});
