import { describe, expect, it } from 'vitest';
import { connectorSchedules, isConnectorName } from './index.js';

describe('isConnectorName', () => {
  it.each(['manual', 'github', 'app-store-connect', 'aws-cost-explorer'])('accepts %s', (name) => {
    expect(isConnectorName(name)).toBe(true);
  });

  it.each(['', 'GitHub', 'app_store', '-github', 'github-', 'app--store', 'app store'])(
    'rejects "%s"',
    (name) => {
      expect(isConnectorName(name)).toBe(false);
    },
  );
});

describe('connectorSchedules', () => {
  it('lists the three schedules of the contract', () => {
    expect(connectorSchedules).toEqual(['hourly', 'daily', 'none']);
  });
});
