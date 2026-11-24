import * as React from 'react';
import { Label as LabelPrimitive } from 'radix-ui';

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-meta font-medium text-foreground-soft select-none',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
