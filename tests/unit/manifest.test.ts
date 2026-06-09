import { describe, expect, it } from 'vitest';
import manifest from '../../src/manifest';

describe('extension manifest', () => {
  it('requests alarms permission for MV3-safe online lookup retries', () => {
    expect((manifest as { permissions?: string[] }).permissions).toContain('alarms');
  });

  it('opens the lightweight site-control popup from the extension action', () => {
    expect((manifest as { action?: { default_popup?: string } }).action?.default_popup).toBe('src/popup/index.html');
  });

  it('injects content scripts into frames so embedded reading surfaces work', () => {
    expect((manifest as { content_scripts?: unknown[] }).content_scripts?.[0]).toEqual(
      expect.objectContaining({
        matches: ['http://*/*', 'https://*/*'],
        all_frames: true
      })
    );
  });
});
