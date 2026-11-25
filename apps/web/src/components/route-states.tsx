import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { Brand } from '@/components/brand';
import { CenteredPage, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { messages } from '@/messages';

/** While a route loads what it needs. */
export function RoutePending() {
  return (
    <div className="page">
      <LoadingState />
    </div>
  );
}

/** When a route could not load, or a page threw while rendering. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const queryErrors = useQueryErrorResetBoundary();
  return (
    <div className="page py-6">
      <ErrorState
        {...(error instanceof ApiError
          ? { what: messages.errors.thisPage }
          : { title: messages.errors.pageCrashed })}
        error={error}
        onRetry={() => {
          queryErrors.reset();
          reset();
          void router.invalidate();
        }}
      />
    </div>
  );
}

/** An address that names nothing, or nothing the person may open. */
export function NotFound() {
  return (
    <div className="flex flex-col items-start gap-2 py-6">
      <h1 className="text-title">{messages.errors.notFoundTitle}</h1>
      <p className="text-muted-foreground">{messages.errors.notFoundBody}</p>
      <Button asChild variant="outline" className="mt-2">
        <Link to="/">{messages.errors.goHome}</Link>
      </Button>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <CenteredPage>
      <Brand />
      <div className="mt-8">
        <NotFound />
      </div>
    </CenteredPage>
  );
}
