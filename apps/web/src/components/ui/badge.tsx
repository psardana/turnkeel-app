import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

/**
 * Pills and tags. None is a control: a tag has no hover, no
 * selected and no disabled state.
 */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        // A count that waits on the viewer.
        count:
          'h-[18px] min-w-[18px] rounded-full bg-primary px-[5px] text-micro font-semibold text-primary-foreground tabular-nums',
        // What the viewer has not seen yet. Nothing else is a filled accent tag.
        new: 'rounded-[3px] bg-state-new px-1.5 text-micro font-semibold text-state-new-foreground',
        neutral: 'rounded-[3px] bg-muted px-1.5 py-px text-micro font-medium text-foreground-soft',
        // A party.
        outline: 'rounded-sm border border-muted-foreground px-1.5 text-small text-foreground-soft',
        // Blocked.
        dashed:
          'rounded-sm border border-dashed border-muted-foreground px-1.5 text-small text-foreground-soft',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
);

function Badge({
  className,
  variant = 'neutral',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

/**
 * A count that waits on the viewer. Hidden at 0; above 99 it reads "99+". It is
 * hidden from screen readers: the link it sits in names the count in words.
 */
function CountPill({ count, className }: { count: number | undefined; className?: string }) {
  const label = countLabel(count);
  if (label === null) return null;
  return (
    <Badge variant="count" className={className} aria-hidden="true">
      {label}
    </Badge>
  );
}

export { Badge, badgeVariants, CountPill };
