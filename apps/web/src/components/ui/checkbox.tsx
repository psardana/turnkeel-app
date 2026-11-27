import * as React from 'react';
import { CheckIcon } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/**
 * A box of 18 px with the field line. Ticked, it is filled with the passed colour and
 * its tick is in the ground colour, never in the accent: a tick means done. The box
 * sits in a `<label data-touch>`, which is its target on a phone.
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer relative flex size-[18px] shrink-0 items-center justify-center rounded-[4px] border border-input bg-background transition-colors after:absolute after:-inset-[3px] disabled:cursor-not-allowed aria-invalid:border-destructive data-checked:border-state-passed data-checked:bg-state-passed data-checked:text-background',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
