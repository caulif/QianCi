import { describe, expect, it } from 'vitest';
import { containsQianciAnnotation } from '../../src/content/mutationCompatibility';

describe('content mutation compatibility', () => {
  it('detects a directly added QianCi annotation node', () => {
    const annotation = document.createElement('span');
    annotation.dataset.qianciWord = 'meticulous';

    expect(containsQianciAnnotation([annotation])).toBe(true);
  });

  it('detects a removed container that contains old QianCi annotations', () => {
    const routeRoot = document.createElement('main');
    routeRoot.innerHTML = '<article><span data-qianci-word="meticulous">meticulous</span></article>';

    expect(containsQianciAnnotation([routeRoot], { includeSelf: false })).toBe(true);
  });

  it('ignores a directly removed annotation when only descendants should count', () => {
    const annotation = document.createElement('span');
    annotation.dataset.qianciWord = 'meticulous';

    expect(containsQianciAnnotation([annotation], { includeSelf: false })).toBe(false);
  });

  it('ignores text nodes and ordinary elements', () => {
    const text = document.createTextNode('meticulous');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'The meticulous article remains readable.';

    expect(containsQianciAnnotation([text, paragraph])).toBe(false);
  });
});
