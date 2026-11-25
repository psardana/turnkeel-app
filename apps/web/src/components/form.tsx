import { CircleXIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { messages } from '@/messages';

interface FieldProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  optional?: boolean;
  className?: string;
  /** A filter's label is smaller and quiet. */
  labelClassName?: string;
  /** Gets the ids to put on the control so the label, the hint and the error belong to it. */
  children: (control: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
  }) => ReactNode;
}

/** A labelled control with its hint and its error. Every control in a form goes through this. */
export function Field({
  label,
  hint,
  error,
  optional,
  className,
  labelClassName,
  children,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={id} className={labelClassName}>
        {label}
        {optional ? (
          <span className="font-normal text-muted-foreground">({messages.common.optional})</span>
        ) : null}
      </Label>
      {children({
        id,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-meta text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-meta text-state-failed">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The message of a failed save, above the buttons of a form: the cross and the sentence. */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-state-failed">
      <CircleXIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

/**
 * A sentence that interrupts: what a page cannot do here and why, such as local mode
 * or an archived project. An interrupting box: the strong line,
 * 8 px corners, no fill.
 */
export function Notice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'max-w-prose rounded-xl border border-border-strong px-3 py-2.5 text-foreground-soft',
        className,
      )}
    >
      {children}
    </p>
  );
}
