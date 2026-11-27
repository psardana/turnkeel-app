import { CheckIcon, ClockIcon, CogIcon, FileIcon, UsersIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { messages } from '@/messages';

/**
 * Holder marks: a small glyph and a name. Each glyph differs
 * from the others in shape, so a mark reads the same in grey. The glyph is hidden
 * from screen readers; the name is real text and is never left out.
 *
 * - You, the viewer: a filled circle in the accent, and "You".
 * - A person: a ring with the first letter of the name, and the name.
 * - An agent: a filled square, and the agent's name in mono.
 * - A party: the name in a tag with a solid outline.
 * - Until a date: a clock, and "Until 18 Nov".
 * - Blocked: a tag with a dashed outline, "Blocked by" and the blocker's key, then the
 *   mark of whoever holds the blocker's turn; "Blocked" alone when the blocker is not
 *   the viewer's to read.
 * - Unassigned: a dashed, empty ring.
 * - Done: a tick, and "Done 4 Nov".
 * - Anyone who may act: a two-people icon, and the action in words.
 * - The system: a cog, and "System" in quiet text.
 * - A file (a gate that only its file has written): a file icon, and the path in mono.
 * - Someone outside (the sender of an inbox item): no glyph, the name in soft text, no box.
 */
export type Holder =
  | { kind: 'you' }
  /** `empty`: a person named by kind alone, as a Tester sees others: no initial. */
  | { kind: 'person'; name: string; empty?: boolean }
  /** `generic`: an agent named by kind alone ("Agent"), which is a word, set in the body face. */
  | { kind: 'agent'; name: string; generic?: boolean }
  | { kind: 'party'; name: string }
  | { kind: 'until'; date: string }
  | { kind: 'blocked'; key: string | null; then?: Holder | null }
  | { kind: 'unassigned' }
  | { kind: 'done'; date: string }
  | { kind: 'anyone'; action: string }
  | { kind: 'system' }
  | { kind: 'file'; path: string }
  /** The sender of an inbox item, as the item names them: outside text, drawn as plain text. */
  | { kind: 'outside'; name: string };

function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?';
}

/** The name a mark reads as, for an accessible name or a `title`. */
export function holderName(holder: Holder): string {
  switch (holder.kind) {
    case 'you':
      return messages.holder.you;
    case 'person':
    case 'agent':
    case 'party':
      return holder.name;
    case 'until':
      return messages.holder.until(holder.date);
    case 'blocked':
      return holder.key === null
        ? messages.holder.blocked
        : `${messages.holder.blockedBy} ${holder.key}`;
    case 'unassigned':
      return messages.holder.unassigned;
    case 'done':
      return messages.holder.done(holder.date);
    case 'anyone':
      return messages.holder.anyone(holder.action);
    case 'system':
      return messages.holder.system;
    case 'file':
      return holder.path;
    case 'outside':
      return holder.name;
  }
}

export function HolderMark({ holder, className }: { holder: Holder; className?: string }) {
  // At most the width it is given, so a long name is cut, never pushed past its column.
  const base = cn('inline-flex max-w-full min-w-0 items-center gap-1.5', className);
  switch (holder.kind) {
    case 'you':
      return (
        <span className={base}>
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-primary" />
          <span className="truncate">{messages.holder.you}</span>
        </span>
      );
    case 'person':
      return (
        <span className={base}>
          <span
            aria-hidden="true"
            className="grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px] border-muted-foreground text-[0.625rem] leading-none font-semibold text-foreground-soft"
          >
            {holder.empty === true ? null : initialOf(holder.name)}
          </span>
          <span className="truncate">{holder.name}</span>
        </span>
      );
    case 'agent':
      return (
        <span className={base}>
          <span aria-hidden="true" className="size-2.5 shrink-0 bg-foreground" />
          <span className={cn('truncate', holder.generic !== true && 'font-mono text-[0.92em]')}>
            {holder.name}
          </span>
        </span>
      );
    case 'party':
      return (
        <span className={base}>
          <span className="truncate rounded-sm border border-muted-foreground px-1.5 text-small text-foreground-soft">
            {holder.name}
          </span>
        </span>
      );
    case 'until':
      return (
        <span className={base}>
          <ClockIcon aria-hidden="true" className={iconClass} strokeWidth={1.75} />
          <span className="truncate">{messages.holder.until(holder.date)}</span>
        </span>
      );
    case 'blocked':
      return (
        <span className={cn(base, 'flex-wrap')}>
          <span className="inline-flex items-center gap-1 rounded-sm border border-dashed border-muted-foreground px-1.5 text-small whitespace-nowrap text-foreground-soft">
            {holder.key === null ? (
              messages.holder.blocked
            ) : (
              <>
                {messages.holder.blockedBy} <span className="font-mono">{holder.key}</span>
              </>
            )}
          </span>
          {holder.key !== null && holder.then ? <HolderMark holder={holder.then} /> : null}
        </span>
      );
    case 'unassigned':
      return (
        <span className={cn(base, 'text-muted-foreground')}>
          <span
            aria-hidden="true"
            className="size-3.5 shrink-0 rounded-full border-[1.5px] border-dashed border-muted-foreground"
          />
          <span className="truncate">{messages.holder.unassigned}</span>
        </span>
      );
    case 'done':
      return (
        <span className={cn(base, 'text-foreground-soft')}>
          <CheckIcon aria-hidden="true" className={iconClass} strokeWidth={1.75} />
          <span className="truncate">{messages.holder.done(holder.date)}</span>
        </span>
      );
    case 'anyone':
      return (
        <span className={base}>
          <UsersIcon aria-hidden="true" className={iconClass} strokeWidth={1.75} />
          <span className="truncate">{messages.holder.anyone(holder.action)}</span>
        </span>
      );
    case 'system':
      return (
        <span className={cn(base, 'text-muted-foreground')}>
          <CogIcon aria-hidden="true" className={iconClass} strokeWidth={1.75} />
          <span className="truncate">{messages.holder.system}</span>
        </span>
      );
    case 'file':
      return (
        <span className={base}>
          <FileIcon aria-hidden="true" className={iconClass} strokeWidth={1.75} />
          <span className="truncate font-mono text-[0.92em]" title={holder.path}>
            {holder.path}
          </span>
        </span>
      );
    case 'outside':
      return (
        <span className={cn(base, 'text-foreground-soft')}>
          <span className="truncate" title={holder.name}>
            {holder.name}
          </span>
        </span>
      );
  }
}
