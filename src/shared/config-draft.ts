import { type Config, saveConfig } from './config';

const equal = (a: Config, b: Config) => JSON.stringify(a) === JSON.stringify(b);

/** Options-page transaction: edits stay local until an explicit save. */
export class ConfigDraft {
  value: Config;
  state: 'idle' | 'dirty' | 'saving' | 'saved' | 'error' = 'idle';
  conflict = false;
  private baseline: Config;
  private latest: Config;
  private observedDuringSave?: Config;

  constructor(initial: Config, private changed: () => void,
    private write: (value: Config) => Promise<void> = saveConfig) {
    this.value = structuredClone(initial);
    this.baseline = structuredClone(initial);
    this.latest = structuredClone(initial);
  }

  get dirty(): boolean { return !equal(this.value, this.baseline); }

  update(next: Config): void {
    if (this.state === 'saving') return;
    this.value = next;
    this.state = this.dirty ? 'dirty' : 'idle';
    this.changed();
  }

  receive(next: Config, pendingFields = false): void {
    this.latest = structuredClone(next);
    if (this.state === 'saving') { this.observedDuringSave = next; return; }
    if (this.dirty || pendingFields) {
      this.conflict = !equal(next, this.baseline);
      this.changed();
    } else {
      this.value = structuredClone(next);
      this.baseline = structuredClone(next);
      this.conflict = false;
      this.state = 'idle';
      this.changed();
    }
  }

  reset(): void {
    if (this.state === 'saving') return;
    this.value = structuredClone(this.latest);
    this.baseline = structuredClone(this.latest);
    this.conflict = false;
    this.state = 'idle';
    this.changed();
  }

  async save(overwrite = false): Promise<boolean> {
    if (this.state === 'saving' || (this.conflict && !overwrite) || !this.dirty) return false;
    const snapshot = structuredClone(this.value);
    this.observedDuringSave = undefined;
    this.state = 'saving';
    this.changed();
    try {
      await this.write(snapshot);
      this.baseline = snapshot;
      this.latest = structuredClone(this.observedDuringSave ?? snapshot);
      this.conflict = !equal(this.latest, snapshot);
      this.state = 'saved';
      this.changed();
      return true;
    } catch {
      this.state = 'error';
      this.changed();
      return false;
    }
  }
}
