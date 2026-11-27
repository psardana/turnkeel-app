import * as React from 'react';
import { XIcon } from 'lucide-react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { messages } from '@/messages';

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/40 duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A sheet: from the bottom on a phone, with top corners of
 * 12 px and at most 85 percent of the screen high, or from the right at 560 px. Its
 * first row is a bar with the title and Close. A sheet that shows an item passes the
 * host's controls in `bar`: they take the title's place in the one bar, and the title
 * is read by screen readers only ("In a sheet the sheet's own bar is the
 * host bar"). The bar leaves room for the focus ring of Close. The box keeps
 * `outline-none`: focus goes to a control inside it.
 */
function SheetContent({
  className,
  children,
  side = 'bottom',
  title,
  bar,
  ...props
}: Omit<React.ComponentProps<typeof SheetPrimitive.Content>, 'title'> & {
  side?: 'right' | 'bottom';
  /** The sheet's name, shown in its bar unless `bar` is given. */
  title: string;
  /** The host's controls, drawn in the sheet's bar in place of the title. */
  bar?: React.ReactNode;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        // A sheet that has a description passes its id here.
        aria-describedby={undefined}
        className={cn(
          'fixed z-50 flex flex-col border-border bg-popover text-body text-popover-foreground shadow-raised duration-200 outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:max-h-[85dvh] data-[side=bottom]:rounded-t-[12px] data-[side=bottom]:border-t data-[side=bottom]:pb-[env(safe-area-inset-bottom)] data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:w-full data-[side=right]:max-w-[560px] data-[side=right]:border-l data-[side=right]:data-open:slide-in-from-right-10',
          className,
        )}
        {...props}
      >
        <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-2 border-b py-1 pr-2 pl-4">
          <SheetPrimitive.Title
            data-slot="sheet-title"
            className={bar === undefined ? 'text-base leading-6 font-semibold' : 'sr-only'}
          >
            {title}
          </SheetPrimitive.Title>
          {bar}
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button variant="ghost" size="icon">
              <XIcon aria-hidden="true" />
              <span className="sr-only">{messages.common.close}</span>
            </Button>
          </SheetPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-body text-muted-foreground', className)}
      {...props}
    />
  );
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetTrigger };
