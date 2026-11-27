import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircleIcon } from 'lucide-react';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';

/**
 * The buttons of the app: primary (`default`), quiet (`outline`),
 * destructive, and ghost for icons in bars. The focus ring is the one of
 * src/styles/app.css, so no variant draws a ring of its own.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-body font-medium whitespace-nowrap transition-colors select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        // A pressed toggle keeps its label and takes the selected fill and the accent.
        outline:
          'border-border-strong bg-background text-foreground hover:bg-muted aria-pressed:border-primary aria-pressed:bg-selected aria-pressed:font-semibold aria-pressed:text-primary data-[state=on]:border-primary data-[state=on]:bg-selected data-[state=on]:font-semibold data-[state=on]:text-primary',
        ghost: 'text-foreground hover:bg-muted aria-expanded:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive-hover',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        sm: "h-7 gap-1 px-2.5 text-meta has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        icon: 'size-8',
        'icon-sm': 'size-7',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

/** A disabled button has colours of its own, never half opacity. */
const disabledLook =
  'cursor-default border-transparent bg-muted text-muted-foreground hover:bg-muted';

const isTrue = (value: unknown) => value === true || value === 'true';

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  pending = false,
  disabled = false,
  onClick,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /**
     * A write is on its way. The button ignores a press and shows a spinner in front
     * of its label; its colours, its label and its width stay.
     */
    pending?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';
  // A button that cannot act stays focusable, so what is written beside it can be
  // reached. It says so with aria-disabled and ignores a press.
  const off = disabled || isTrue(props['aria-disabled']);
  const inert = off || pending;

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-pending={pending ? '' : undefined}
      className={cn(buttonVariants({ variant, size }), off && disabledLook, className)}
      {...props}
      aria-disabled={inert ? true : undefined}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        if (inert) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
    >
      {pending && !asChild ? (
        <>
          <LoaderCircleIcon data-slot="spinner" className="animate-spin" aria-hidden="true" />
          {/* The spinner takes the place of a leading icon. */}
          <span className="contents [&>svg:first-child]:hidden">{children}</span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
