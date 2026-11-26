import type { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useReturnFocus } from '@/lib/return-focus';
import { messages } from '@/messages';

/** Asks before something that cannot be taken back. Escape and Cancel both leave. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  onConfirm,
  pending = false,
  confirmDisabled = false,
  fields,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  /** Keeps the confirm button disabled, such as until the workspace's address is typed. */
  confirmDisabled?: boolean;
  /** A field the question needs, drawn under the description and not read as part of it. */
  fields?: ReactNode;
  /** Where the focus goes when it closes, for a dialog opened from a menu (`useReturnFocus`). */
  returnFocus?: () => HTMLElement | null;
}) {
  const focus = useReturnFocus(returnFocus);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent {...focus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{children}</AlertDialogDescription>
        </AlertDialogHeader>
        {fields}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{messages.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending || confirmDisabled}
            onClick={(event) => {
              // The dialog stays open until the request has answered.
              event.preventDefault();
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
