import {
  CircleCheckIcon,
  CircleXIcon,
  InfoIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** On a phone a toast sits under the top bar, with 8 px between them. */
const UNDER_TOP_BAR = 'calc(var(--topbar-height) + 0.5rem + env(safe-area-inset-top))';

/**
 * Short messages after a write: one sentence, no title, at most
 * three at once. Bottom right on wide screens. On a phone, top centre under the top
 * bar: at the bottom a message lies over the last buttons of a page that is scrolled
 * to its end, such as Save and Archive of a project. A message never
 * carries the only copy of something the person needs.
 */
function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  const phone = usePhone();
  return (
    <Sonner
      theme={resolved}
      position={phone ? 'top-center' : 'bottom-right'}
      visibleToasts={3}
      {...(phone ? { offset: { top: UNDER_TOP_BAR }, mobileOffset: { top: UNDER_TOP_BAR } } : {})}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-foreground" />,
        info: <InfoIcon className="size-4 text-foreground" />,
        warning: <TriangleAlertIcon className="size-4 text-state-changes" />,
        error: <CircleXIcon className="size-4 text-state-failed" />,
        loading: <LoaderCircleIcon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
          // Sonner's own stylesheet sets the system font on the toaster, outside any
          // layer, so it beats the base layer; this puts IBM Plex Sans back.
          fontFamily: 'var(--font-ui)',
        } as CSSProperties
      }
      containerAriaLabel={messages.common.messagesRegion}
      toastOptions={{
        duration: 4000,
        closeButtonAriaLabel: messages.common.close,
        classNames: { toast: 'text-body! shadow-raised!' },
      }}
      {...props}
    />
  );
}

export { Toaster };
