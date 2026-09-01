import { describe, expect, it } from 'vitest';
import { MAP_PROFILE_CATALOG } from './catalog';
import { serializeApplicationJson } from './html-payload';

describe('map profile HTML payload serialization', () => {
  it('round-trips script-breaking and Unicode line-separator characters safely', () => {
    const value = { label: '</script><script>bad()</script>\u2028next\u2029last' };
    const serialized = serializeApplicationJson(value);

    expect(serialized).not.toContain('<');
    expect(serialized).not.toContain('\u2028');
    expect(serialized).not.toContain('\u2029');
    expect(serialized).toContain('\\u003c/script>');
    expect(serialized).toContain('\\u2028');
    expect(serialized).toContain('\\u2029');
    expect(JSON.parse(serialized)).toEqual(value);
  });

  it('round-trips both build profiles without changing their data shape', () => {
    expect(JSON.parse(serializeApplicationJson(MAP_PROFILE_CATALOG))).toStrictEqual(MAP_PROFILE_CATALOG);
  });
});
