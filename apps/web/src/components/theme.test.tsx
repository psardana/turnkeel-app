import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import { ThemeSwitch } from './theme';

describe('the theme switch', () => {
  it('offers Light, Dark and System, and Light is the one that is on at first', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitch />);
    await user.click(screen.getByRole('button', { name: 'Theme: Light' }));

    const menu = screen.getByRole('menu');
    const options = within(menu).getAllByRole('menuitemradio');
    expect(options.map((option) => option.textContent)).toEqual(['Light', 'Dark', 'System']);
    expect(within(menu).getByRole('menuitemradio', { name: 'Light' })).toBeChecked();
  });

  it('works from the keyboard: open, move, choose', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitch />);
    screen.getByRole('button', { name: 'Theme: Light' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');

    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    // The menu closed, and the button says what is on now.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toBeInTheDocument();
  });

  it('goes back to Light', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitch />);
    await user.click(screen.getByRole('button', { name: /^Theme:/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
});
