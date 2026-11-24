import { cn } from '@/lib/utils';

/** A still or pulsing surface in the shape of what is loading. It is decoration: the words beside it say "Loading". */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-sm bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
