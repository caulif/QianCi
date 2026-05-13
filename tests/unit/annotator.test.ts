import { describe, expect, it } from 'vitest';
import { createAnnotatedFragment } from '../../src/content/annotator';

describe('annotator', () => {
  it('wraps only words chosen by the decider and preserves text content', () => {
    const fragment = createAnnotatedFragment('The unobtrusive tool was meticulous.', (token) =>
      ['unobtrusive', 'meticulous'].includes(token.normalized)
    );
    const host = document.createElement('p');
    host.append(fragment);

    expect(host.textContent).toBe('The unobtrusive tool was meticulous.');
    expect(host.querySelectorAll('[data-qianci-word]').length).toBe(2);
    expect(host.querySelector('[data-qianci-word="unobtrusive"]')?.textContent).toBe('unobtrusive');
  });
});
