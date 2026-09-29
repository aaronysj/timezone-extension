import { type Config, saveConfig } from './config';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Serializes writes and retains an unsaved draft for retry on storage failure. */
export class ConfigEditor {
  value: Config;
  state: SaveState = 'idle';
  private revision = 0;
  private pending = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(initial: Config, private changed: () => void, private feedback: () => void,
    private write: (value: Config) => Promise<void> = saveConfig) { this.value = initial; }

  update(next: Config): Promise<boolean> {
    this.value = next;
    const revision = ++this.revision;
    this.pending++;
    this.state = 'saving';
    this.changed();
    this.feedback();
    const task = this.queue.then(async () => {
      let saved = false;
      try { await this.write(next); saved = true; } catch { /* Preserve the draft for retry. */ }
      this.pending--;
      if (revision === this.revision) {
        this.state = saved ? 'saved' : 'error';
        this.feedback();
      }
      return saved;
    });
    this.queue = task.then(() => {});
    return task;
  }

  receive(next: Config): void {
    if (this.pending || this.state === 'error' || JSON.stringify(next) === JSON.stringify(this.value)) return;
    this.value = next;
    this.state = 'idle';
    this.changed();
    this.feedback();
  }

  retry(): Promise<boolean> { return this.update(this.value); }
}
