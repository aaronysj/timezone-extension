import { describe, expect, it, vi } from 'vitest';
import { ConfigDraft } from '../src/shared/config-draft';
import type { Config } from '../src/shared/config';

const config = (): Config => ({ mode: 'rules', timezone: 'Asia/Shanghai', rules: [] });

describe('explicit configuration saves', () => {
  it('stages multiple changes and writes the complete snapshot once', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const draft = new ConfigDraft(config(), vi.fn(), write);
    draft.update({ ...draft.value, mode: 'global' });
    draft.update({ ...draft.value, timezone: 'Asia/Tokyo' });
    expect(write).not.toHaveBeenCalled();
    expect(draft.dirty).toBe(true);
    await draft.save();
    expect(write).toHaveBeenCalledExactlyOnceWith({ mode: 'global', timezone: 'Asia/Tokyo', rules: [] });
    expect(draft.dirty).toBe(false);
  });
  it('retains a failed draft for an explicit retry', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValueOnce(undefined);
    const draft = new ConfigDraft(config(), vi.fn(), write);
    draft.update({ ...config(), timezone: 'Asia/Tokyo' });
    expect(await draft.save()).toBe(false);
    expect(draft.state).toBe('error');
    expect(draft.value.timezone).toBe('Asia/Tokyo');
    expect(await draft.save()).toBe(true);
    expect(draft.state).toBe('saved');
  });
  it('rejects duplicate saves and edits while a save is in flight', async () => {
    let release!: () => void;
    const write = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const draft = new ConfigDraft(config(), vi.fn(), write);
    draft.update({ ...config(), timezone: 'Asia/Tokyo' });
    const first = draft.save();
    expect(await draft.save()).toBe(false);
    draft.update({ ...config(), timezone: 'America/New_York' });
    expect(draft.value.timezone).toBe('Asia/Tokyo');
    release();
    expect(await first).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('protects unsaved edits against other windows and resets to the latest configuration', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const draft = new ConfigDraft(config(), vi.fn(), write);
    draft.update({ ...config(), timezone: 'Asia/Tokyo' });
    draft.receive({ ...config(), timezone: 'Europe/London' });
    expect(draft.value.timezone).toBe('Asia/Tokyo');
    expect(draft.conflict).toBe(true);
    expect(await draft.save()).toBe(false);
    expect(write).not.toHaveBeenCalled();
    draft.reset();
    expect(draft.value.timezone).toBe('Europe/London');
    expect(draft.dirty).toBe(false);
  });
  it('requires an explicit overwrite when there are external changes', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const draft = new ConfigDraft(config(), vi.fn(), write);
    draft.update({ ...config(), timezone: 'Asia/Tokyo' });
    draft.receive({ ...config(), timezone: 'Europe/London' });
    expect(await draft.save(true)).toBe(true);
    expect(draft.conflict).toBe(false);
  });
  it('adopts external changes only when the form has no pending edits', () => {
    const draft = new ConfigDraft(config(), vi.fn());
    draft.receive({ ...config(), timezone: 'Europe/London' });
    expect(draft.value.timezone).toBe('Europe/London');
    draft.receive({ ...config(), timezone: 'Asia/Tokyo' }, true);
    expect(draft.value.timezone).toBe('Europe/London');
    expect(draft.conflict).toBe(true);
  });
});
