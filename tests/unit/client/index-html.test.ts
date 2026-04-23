import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const html = readFileSync(resolve(import.meta.dir, '../../../src/client/index.html'), 'utf-8');

describe('index.html does not expose removed backend-selection UI', () => {
  it('has no #inp-terminal element', () => {
    expect(html).not.toContain('id="inp-terminal"');
  });
});
