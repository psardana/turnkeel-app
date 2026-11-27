import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('keeps a size of the type scale beside a text colour', () => {
    expect(cn('text-item', 'text-foreground-soft')).toBe('text-item text-foreground-soft');
    expect(cn('text-muted-foreground', 'text-meta')).toBe('text-muted-foreground text-meta');
  });

  it('lets the later of two sizes win', () => {
    expect(cn('text-item', 'text-meta')).toBe('text-meta');
    expect(cn('text-sm', 'text-body')).toBe('text-body');
  });

  it('still lets the later of two colours win', () => {
    expect(cn('text-foreground', 'text-primary')).toBe('text-primary');
  });
});
