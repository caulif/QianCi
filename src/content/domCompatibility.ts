export const SKIP_SELECTOR = [
  'script',
  'style',
  'noscript',
  'textarea',
  'input',
  'select',
  'button',
  'option',
  'svg',
  'math',
  'canvas',
  'audio',
  'video',
  'iframe',
  'summary',
  'label',
  'code',
  'pre',
  '[hidden]',
  '[inert]',
  '[aria-hidden="true"]',
  '[role="textbox"]',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="searchbox"]',
  '[contenteditable]:not([contenteditable="false"])',
  '.monaco-editor',
  '.cm-editor',
  '.CodeMirror',
  '.qianci-ignore',
  '[data-qianci-ignore]',
  '[data-qianci-tooltip]',
  '[data-qianci-word]'
].join(',');

/**
 * Checks whether a text node belongs to a region QianCi must not rewrite.
 *
 * @param text Text node collected by the scan queue.
 * @returns True when the node should be ignored by automatic annotation.
 */
export function shouldSkipTextNode(text: Text): boolean {
  const parent = text.parentElement;
  if (!parent) {
    return true;
  }
  return (
    Boolean(parent.closest(SKIP_SELECTOR)) ||
    hasHiddenAncestor(parent) ||
    hasClosedDetailsAncestor(parent) ||
    hasClosedDialogAncestor(parent) ||
    hasCollapsedAriaPanelAncestor(parent) ||
    hasBootstrapCollapsedAncestor(parent) ||
    hasInactiveAriaTabPanelAncestor(parent) ||
    hasBootstrapInactiveTabPaneAncestor(parent)
  );
}

/**
 * Checks whether an element or one of its ancestors is hidden by inline style.
 *
 * @param element Element that owns a text node.
 * @returns True when automatic annotation should ignore this subtree.
 */
export function hasHiddenAncestor(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const display = current.style.display.trim().toLowerCase();
    const visibility = current.style.visibility.trim().toLowerCase();
    if (display === 'none' || visibility === 'hidden' || visibility === 'collapse' || hasCommonHiddenClass(current)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks for common framework classes that explicitly mean display none.
 *
 * @param element Element whose class list should be checked.
 * @returns True when the element uses a known hidden utility class.
 */
function hasCommonHiddenClass(element: HTMLElement): boolean {
  return (
    element.classList.contains('d-none') ||
    element.classList.contains('hidden') ||
    element.classList.contains('is-hidden')
  );
}

/**
 * Checks whether an element is inside a collapsed details panel body.
 *
 * @param element Element that owns a text node.
 * @returns True when the text is hidden until the details element opens.
 */
export function hasClosedDetailsAncestor(element: HTMLElement): boolean {
  const details = element.closest('details:not([open])');
  if (!details) {
    return false;
  }
  const summary = element.closest('summary');
  return !summary || !details.contains(summary);
}

/**
 * Checks whether an element is inside a closed native dialog.
 *
 * @param element Element that owns a text node.
 * @returns True when the dialog is not open yet.
 */
export function hasClosedDialogAncestor(element: HTMLElement): boolean {
  return Boolean(element.closest('dialog:not([open])'));
}

/**
 * Checks whether text is inside a panel controlled by a collapsed ARIA trigger.
 *
 * @param element Element that owns a text node.
 * @returns True when a matching aria-controls trigger is collapsed.
 */
export function hasCollapsedAriaPanelAncestor(element: HTMLElement): boolean {
  const doc = element.ownerDocument;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (!current.id) {
      continue;
    }

    if (isExplicitlyShownCollapse(current)) {
      continue;
    }

    const controllers = Array.from(doc.querySelectorAll<HTMLElement>('[aria-controls][aria-expanded="false"]'));
    if (controllers.some((controller) => (controller.getAttribute('aria-controls') ?? '').split(/\s+/).includes(current.id))) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether text is inside a Bootstrap-style collapsed panel.
 *
 * @param element Element that owns a text node.
 * @returns True when a standard collapse container is currently hidden or transitioning.
 */
export function hasBootstrapCollapsedAncestor(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.classList.contains('collapsing')) {
      return true;
    }
    if (current.classList.contains('collapse') && !current.classList.contains('show')) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether text is inside a tabpanel controlled by an inactive ARIA tab.
 *
 * @param element Element that owns a text node.
 * @returns True when a role=tab with aria-selected=false controls this tabpanel.
 */
export function hasInactiveAriaTabPanelAncestor(element: HTMLElement): boolean {
  const doc = element.ownerDocument;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (!current.id || current.getAttribute('role') !== 'tabpanel') {
      continue;
    }

    const tabs = Array.from(doc.querySelectorAll<HTMLElement>('[role="tab"][aria-controls][aria-selected="false"]'));
    if (tabs.some((tab) => (tab.getAttribute('aria-controls') ?? '').split(/\s+/).includes(current.id))) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether text is inside an inactive Bootstrap tab pane.
 *
 * @param element Element that owns a text node.
 * @returns True when a standard tab-pane is not active.
 */
export function hasBootstrapInactiveTabPaneAncestor(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.classList.contains('tab-pane') && !current.classList.contains('active')) {
      return true;
    }
    if (
      current.classList.contains('tab-pane') &&
      current.classList.contains('fade') &&
      current.classList.contains('active') &&
      !current.classList.contains('show')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether an element uses Bootstrap's explicit visible collapse state.
 *
 * @param element Potential collapse panel.
 * @returns True when Bootstrap marks the panel as visible.
 */
function isExplicitlyShownCollapse(element: HTMLElement): boolean {
  return element.classList.contains('collapse') && element.classList.contains('show');
}

/**
 * Checks whether an element currently behaves as a skipped container.
 *
 * @param element Element affected by an attribute mutation.
 * @returns True when existing annotations inside this element should be removed.
 */
export function shouldCleanAnnotatedRoot(element: HTMLElement): boolean {
  return (
    element.matches(SKIP_SELECTOR) ||
    hasHiddenAncestor(element) ||
    hasClosedDetailsAncestor(element) ||
    hasClosedDialogAncestor(element) ||
    hasCollapsedAriaPanelAncestor(element) ||
    hasBootstrapCollapsedAncestor(element) ||
    hasInactiveAriaTabPanelAncestor(element) ||
    hasBootstrapInactiveTabPaneAncestor(element)
  );
}

/**
 * Removes an annotation wrapper while preserving and normalizing visible text.
 *
 * @param element Annotation element created by QianCi.
 * @returns Nothing.
 */
export function removeAnnotationElement(element: HTMLElement): void {
  const parent = element.parentNode;
  const text = element.ownerDocument.createTextNode(element.textContent ?? '');
  element.replaceWith(text);
  parent?.normalize();
}

/**
 * Removes all QianCi annotation wrappers inside a root node.
 *
 * @param root Root whose descendant annotations should be unwrapped.
 * @returns Number of annotation elements removed from the root.
 */
export function removeAnnotationsInRoot(root: ParentNode): number {
  const annotatedWords = Array.from(root.querySelectorAll<HTMLElement>('[data-qianci-word]'));
  for (const element of annotatedWords) {
    removeAnnotationElement(element);
  }
  return annotatedWords.length;
}

/**
 * Prevents annotated-word clicks from triggering page navigation or delegated handlers.
 *
 * @param event User click event fired on an annotated word.
 * @returns Nothing.
 */
export function suppressPageClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/**
 * Detects whether the user is still working with a non-empty text selection.
 *
 * @param doc Document that owns the annotated word.
 * @returns True when click lookup should yield to selection behavior.
 */
export function hasActiveTextSelection(doc: Document): boolean {
  const selection = doc.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}
