import { render, screen } from '@testing-library/react';
import type { ServerInfo } from '@turnkeel/protocol';
import { describe, expect, it } from 'vitest';
import { UnverifiedSignInNote } from './unverified-sign-in';

const server = (github: boolean, google: boolean): ServerInfo => ({
  mode: 'server',
  signIn: { magicLink: true, github, google, passkey: true },
  mail: 'smtp',
  openSignup: false,
});

describe('the settings page on sign-in with GitHub and Google', () => {
  it('says nothing on a server that has neither turned on', () => {
    const { container } = render(<UnverifiedSignInNote server={server(false, false)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says that the one that is turned on has not been run against the provider', () => {
    render(<UnverifiedSignInNote server={server(true, false)} />);
    expect(screen.getByRole('heading', { name: 'Sign-in' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Sign-in with GitHub is turned on for this server. It is built and has not been run against GitHub yet, so it is unverified. Sign-in by link is the tested way in.',
      ),
    ).toBeInTheDocument();
  });

  it('names both when both are turned on', () => {
    render(<UnverifiedSignInNote server={server(true, true)} />);
    expect(
      screen.getByText(
        'Sign-in with GitHub and Google is turned on for this server. It is built and has not been run against GitHub and Google yet, so it is unverified. Sign-in by link is the tested way in.',
      ),
    ).toBeInTheDocument();
  });
});
