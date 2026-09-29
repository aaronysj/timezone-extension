import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chineseI18n } from './i18n-mock';
import { searchTimezones, timeDifference } from '../src/shared/timezone';

const ids = (q: string) => searchTimezones(q).map((z) => z.id);
beforeEach(() => vi.stubGlobal('chrome', { i18n: chineseI18n }));
afterEach(() => vi.unstubAllGlobals());

describe('searchTimezones', () => {
  it('ranks exact city matches first, ignoring spacing and case', () => {
    expect(ids('tokyo')[0]).toBe('Asia/Tokyo');
    expect(ids('New York')[0]).toBe('America/New_York');
    expect(ids('new_york')[0]).toBe('America/New_York');
  });

  it('finds zones by Chinese city name', () => {
    expect(ids('东京')[0]).toBe('Asia/Tokyo');
    expect(ids('上海')).toContain('Asia/Shanghai');
  });

  it('filters by UTC offset', () => {
    for (const q of ['+8', 'GMT+8', 'utc +8', '+08:00']) {
      const res = searchTimezones(q);
      expect(res.map((z) => z.id)).toContain('Asia/Shanghai');
      expect(res.every((z) => z.minutes === 480)).toBe(true);
    }
    expect(ids('+8')[0]).toBe('Asia/Shanghai');
    expect(searchTimezones('+5:30').every((z) => z.minutes === 330)).toBe(true);
    expect(searchTimezones('+5:30').length).toBeGreaterThan(0);
  });

  it('returns everything ordered by offset for an empty query, nothing for junk', () => {
    const all = searchTimezones('');
    expect(all.length).toBeGreaterThan(300);
    expect(all.every((z, i) => i === 0 || all[i - 1]!.minutes <= z.minutes)).toBe(true);
    expect(ids('qqqzzz')).toEqual([]);
  });
});

describe('signed timezone difference', () => {
  it('uses the offset at the current instant, including DST', () => {
    expect(timeDifference('Asia/Shanghai', 'America/Los_Angeles', new Date('2026-09-28T01:00:00Z'))).toBe('+15h');
    expect(timeDifference('Asia/Shanghai', 'America/Los_Angeles', new Date('2026-01-28T01:00:00Z'))).toBe('+16h');
    expect(timeDifference('America/Los_Angeles', 'Asia/Shanghai', new Date('2026-09-28T01:00:00Z'))).toBe('-15h');
  });
  it('preserves half-hour, quarter-hour, and equal-zone differences', () => {
    const at = new Date('2026-09-28T01:00:00Z');
    expect(timeDifference('Asia/Kolkata', 'UTC', at)).toBe('+5.5h');
    expect(timeDifference('Asia/Kathmandu', 'UTC', at)).toBe('+5.75h');
    expect(timeDifference('UTC', 'UTC', at)).toBe('0h');
  });
});
