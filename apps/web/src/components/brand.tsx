import { messages } from '@/messages';

/** Turnkeel's mark: a keel under a deck line. It takes the colour of the text around it. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path d="M3 5.5h18v3H3z" fill="currentColor" />
      <path d="M10.2 10.5h3.6V17a4 4 0 0 1-1.8 3.3 4 4 0 0 1-1.8-3.3z" fill="currentColor" />
    </svg>
  );
}

/** The mark in the accent, then the product name at 15 px, 600. */
export function Brand() {
  return (
    <span className="flex items-center gap-2 text-line font-semibold">
      <Mark className="size-5 text-primary" />
      <span>{messages.appName}</span>
    </span>
  );
}
