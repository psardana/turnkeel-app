import { CircleXIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { messages } from '@/messages';

/**
 * The three states every view has besides its data ("Rules for every
 * tab"): loading, empty with what will make data appear, and an error that says what
 * failed and offers Retry. None of them has a box.
 */
export function LoadingState({ label, className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex items-center gap-2 py-8 text-muted-foreground', className)}
    >
      <LoaderCircleIcon data-slot="spinner" className="size-4 animate-spin" aria-hidden="true" />
      <span>{label ?? messages.common.loading}</span>
    </div>
  );
}

/**
 * Skeleton rows in the shape of a list that is loading. The word "Loading" is there for
 * a screen reader, and on screen too when motion is reduced, because a skeleton that
 * does not pulse is too faint to read as loading.
 */
export function LoadingRows({
  rows,
  row,
  className,
  rowClassName,
}: {
  rows: number;
  /** One row in the shape of the list's own rows. Without it a row is one bar. */
  row?: ReactNode;
  className?: string;
  rowClassName?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <p className="sr-only text-meta text-muted-foreground motion-reduce:not-sr-only motion-reduce:mb-2">
        {messages.common.loading}
      </p>
      <ul aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <li
            key={index}
            data-slot="loading-row"
            className={cn('border-b', row ? undefined : 'py-2.5', rowClassName)}
          >
            {row ?? <Skeleton className="h-5 w-full max-w-xl" />}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-start gap-1 py-8', className)}>
      <h2 className="text-body font-medium">{title}</h2>
      {children ? <p className="max-w-prose text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  what,
  title,
  error,
  onRetry,
  className,
}: {
  /** What could not be loaded, as the subject of a sentence: "The projects". */
  what?: string;
  /** The whole first line, for an error that is not about loading one thing. */
  title?: string;
  error: unknown;
  onRetry?: (() => void) | undefined;
  className?: string;
}) {
  const api = error instanceof ApiError ? error : null;
  return (
    <div role="alert" className={cn('flex flex-col items-start gap-1 py-8', className)}>
      <h2 className="flex items-center gap-2 text-body font-medium">
        <CircleXIcon className="size-4 shrink-0 text-state-failed" aria-hidden="true" />
        {api?.status === 403
          ? messages.errors.forbiddenTitle
          : (title ?? messages.errors.loadFailed(what ?? messages.errors.thisPage))}
      </h2>
      <p className="max-w-prose text-muted-foreground">{errorMessage(error)}</p>
      {api?.requestId ? (
        // The request id is in mono, its label is not. The rule a
        // refusal names is not shown: it stays in the event log's data and the export.
        <p className="text-meta text-muted-foreground">
          <span>
            {messages.errors.requestId} <code className="font-mono">{api.requestId}</code>
          </span>
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" className="mt-3" onClick={onRetry}>
          {messages.common.retry}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Names the page in the browser: "<view> · <project> · Turnkeel". The router does not do
 * this by itself.
 */
export function useDocumentTitle(parts: readonly (string | null | undefined)[]): void {
  const title = [...parts.filter((part): part is string => Boolean(part)), messages.appName].join(
    ' · ',
  );
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/**
 * A view's title with one line under it and, on the right, what the view offers. The
 * `h1` takes focus when the person moves to another view (`AppFrame`), so it has
 * `tabindex="-1"`. It also names the page in the browser.
 */
export function PageHeader({
  title,
  intro,
  actions,
  project,
  ref,
}: {
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
  /** The project the view shows, for the page's name in the browser. */
  project?: string | null | undefined;
  ref?: Ref<HTMLHeadingElement>;
}) {
  useDocumentTitle([title, project]);
  // A view that loads its data first shows its heading after the move to it, so the
  // heading takes the focus itself when it appears.
  const headingRef = useCallback(
    (node: HTMLHeadingElement | null) => {
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
      if (node) takeViewHeadingFocus(node);
    },
    [ref],
  );
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 ref={headingRef} tabIndex={-1} className="text-title focus-visible:outline-none">
          {title}
        </h1>
        {intro ? <p className="mt-1 max-w-prose text-muted-foreground">{intro}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A whole page with one message in the middle: sign-in, not found, first run. */
export function CenteredPage({ children }: { children: ReactNode }) {
  return (
    <main id="content" className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-12">
      {children}
    </main>
  );
}
