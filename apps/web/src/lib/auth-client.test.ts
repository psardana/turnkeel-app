import { describe, expect, it } from 'vitest';
import { messages } from '@/messages';
import { authErrorMessage } from './auth-client';

describe('the sentence of a failed sign-in call', () => {
  it('is the one Better Auth sent, when it sent one', () => {
    expect(
      authErrorMessage({ message: 'This server takes new accounts by invitation only.' }),
    ).toBe('This server takes new accounts by invitation only.');
    expect(authErrorMessage({ message: '  ' })).toBeNull();
    expect(authErrorMessage(null)).toBeNull();
  });

  it('is the app’s own for a request that was refused because too many came from one address', () => {
    expect(
      authErrorMessage({ status: 429, message: 'Too many requests. Please try again later.' }),
    ).toBe(messages.signIn.tooMany);
  });
});
