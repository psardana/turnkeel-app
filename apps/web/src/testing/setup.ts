import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Each test starts with an empty page.
afterEach(() => {
  cleanup();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
  window.localStorage.clear();
});
