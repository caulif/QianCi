import type { EnglishToken } from './tokenize';
import { extractEnglishTokens } from './tokenize';

export type TokenDecider = (token: EnglishToken) => boolean;

export function createAnnotatedFragment(text: string, shouldAnnotate: TokenDecider): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const tokens = extractEnglishTokens(text);
  let cursor = 0;

  for (const token of tokens) {
    if (token.start > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, token.start)));
    }

    if (shouldAnnotate(token)) {
      const span = document.createElement('span');
      span.className = 'qianci-word';
      span.dataset.qianciWord = token.normalized;
      span.tabIndex = 0;
      span.setAttribute('role', 'button');
      span.setAttribute('aria-label', `查看 ${token.normalized} 的释义`);
      span.setAttribute('aria-keyshortcuts', 'Enter Space');
      span.setAttribute('aria-haspopup', 'dialog');
      span.setAttribute('aria-expanded', 'false');
      span.textContent = token.text;
      fragment.append(span);
    } else {
      fragment.append(document.createTextNode(token.text));
    }

    cursor = token.end;
  }

  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)));
  }

  return fragment;
}
