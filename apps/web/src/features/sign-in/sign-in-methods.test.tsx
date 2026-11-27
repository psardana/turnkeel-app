import type { ServerInfo } from '@turnkeel/protocol';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignInMethods } from './sign-in-methods';
import { safeNext, signInError } from './sign-in-page';

const magicLink = vi.fn<(input: Record<string, unknown>) => Promise<{ error: null }>>();

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: {
      magicLink: (input: Record<string, unknown>) => magicLink(input),
      social: vi.fn(),
      passkey: vi.fn(),
    },
  },
  authErrorMessage: () => null,
}));

const server = (overrides: Partial<ServerInfo['signIn']> = {}, mail: ServerInfo['mail'] = 'smtp') =>
  ({
    mode: 'server',
    signIn: { magicLink: true, github: false, google: false, passkey: false, ...overrides },
    mail,
    openSignup: false,
  }) satisfies ServerInfo;

beforeEach(() => {
  magicLink.mockReset();
  magicLink.mockResolvedValue({ error: null });
});

describe('the sign-in methods', () => {
  it('shows the link by mail alone when nothing else is configured', () => {
    render(<SignInMethods server={server()} next="/" />);
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a sign-in link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /GitHub/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /passkey/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Mail is not configured/)).not.toBeInTheDocument();
  });

  it('shows each further method only when the server says it is configured', () => {
    const { rerender } = render(<SignInMethods server={server({ github: true })} next="/" />);
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument();

    rerender(<SignInMethods server={server({ google: true, passkey: true })} next="/" />);
    expect(screen.queryByRole('button', { name: /GitHub/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeInTheDocument();
  });

  it('says where the link is when mail is not configured', () => {
    render(<SignInMethods server={server({}, 'log')} next="/" />);
    expect(
      screen.getByText('Mail is not configured. The link is in the server log.'),
    ).toBeInTheDocument();
  });

  it('asks for a link that comes back to where the person was going, and says the same whoever asks', async () => {
    const user = userEvent.setup();
    render(<SignInMethods server={server()} next="/w/acme/activity" />);
    await user.type(screen.getByLabelText('Email address'), 'pat@example.com');
    await user.click(screen.getByRole('button', { name: 'Send a sign-in link' }));

    expect(magicLink).toHaveBeenCalledWith({
      email: 'pat@example.com',
      callbackURL: '/w/acme/activity',
      errorCallbackURL: '/sign-in?next=%2Fw%2Facme%2Factivity',
    });
    expect(await screen.findByRole('heading', { name: 'Check your mail' })).toBeInTheDocument();
    expect(
      screen.getByText(/If pat@example.com can sign in, a link is on its way/),
    ).toBeInTheDocument();
  });

  it('keeps the address fixed on the invitation page', () => {
    render(<SignInMethods server={server()} next="/" email="invited@example.com" />);
    const input = screen.getByLabelText('Email address');
    expect(input).toHaveValue('invited@example.com');
    expect(input).toHaveAttribute('readonly');
  });
});

describe('the way back after signing in', () => {
  it('takes a path of this app and nothing else', () => {
    expect(safeNext('/w/acme/activity?project=APP')).toBe('/w/acme/activity?project=APP');
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext('https://evil.example/')).toBe('/');
    expect(safeNext('//evil.example/')).toBe('/');
    expect(safeNext('/sign-in?next=/sign-in')).toBe('/');
  });

  it('keeps the query and the fragment of a path of this app', () => {
    expect(safeNext('/w/acme/activity?project=APP#x')).toBe('/w/acme/activity?project=APP#x');
    expect(safeNext('/invitations/accept?token=abc')).toBe('/invitations/accept?token=abc');
  });

  // A browser reads a backslash as a slash and drops tabs and line breaks from an
  // address, so each of these would otherwise lead to another site.
  it.each([
    '/\\evil.example/x',
    '/\\/evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    '\\\\evil.example',
    ' //evil.example',
    'javascript:alert(1)',
  ])('does not take %j, which a browser would read as another site', (next) => {
    expect(safeNext(next)).toBe('/');
  });

  it('does not lead back to the sign-in page by another spelling of its path', () => {
    expect(safeNext('/./sign-in')).toBe('/');
    expect(safeNext('/x/../sign-in?next=/')).toBe('/');
  });

  it('turns the error of a failed sign-in into a sentence', () => {
    expect(signInError(undefined)).toBeNull();
    expect(signInError('signup_by_invitation')).toBe(
      'This server takes new accounts by invitation only.',
    );
    expect(signInError('INVALID_TOKEN')).toMatch(/already used or has expired/);
    expect(signInError('something_else')).toBe('The sign-in did not finish. Try again.');
  });
});
