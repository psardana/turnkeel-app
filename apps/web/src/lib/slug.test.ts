import { handleSchema, projectKeySchema, slugSchema } from '@turnkeel/protocol';
import { describe, expect, it } from 'vitest';
import { handleFrom, keyFrom, slugFrom } from './slug';

describe('suggestions made from a name', () => {
  it.each([
    ['Harbor App', 'harbor-app'],
    ['  Café  Olé! ', 'cafe-ole'],
    ['Übergröße & Söhne', 'ubergrosse-sohne'],
    ['a--b__c', 'a-b-c'],
    ['---', ''],
  ])('slugFrom(%j) is %j', (name, slug) => {
    expect(slugFrom(name)).toBe(slug);
  });

  it('gives what the server takes, also for a long name', () => {
    const slug = slugFrom('An extremely long workspace name that goes on and on - and on');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slugSchema.safeParse(slug).success).toBe(true);
    expect(
      handleSchema.safeParse(handleFrom('Olive Octavia Owner-Oakenshield the Third')).success,
    ).toBe(true);
  });

  it.each([
    ['Harbor App', 'HA'],
    ['Harbor', 'HAR'],
    ['Go', 'GO'],
    ['One Two Three Four Five Six Seven', 'OTTFFS'],
    ['2 Fast 4 You', 'FY'],
    ['', ''],
  ])('keyFrom(%j) is %j', (name, key) => {
    expect(keyFrom(name)).toBe(key);
    if (key.length >= 2) expect(projectKeySchema.safeParse(key).success).toBe(true);
  });
});
