import { toast } from 'sonner';

/**
 * A write the server refused or that was rolled back. It stays
 * until it is closed, with the cross icon and the server's sentence. The page also
 * shows the earlier value again, so this is never the only copy of what happened.
 */
export function toastFailure(message: string): void {
  toast.error(message, { duration: Infinity, closeButton: true });
}
