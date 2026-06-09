export const SKIP_SELECTOR = [
  'script',
  'style',
  'noscript',
  'nav',
  '[role="navigation"]',
  'aside',
  '[role="complementary"]',
  'body > footer',
  '[role="contentinfo"]',
  'textarea',
  'input',
  'select',
  'button',
  'option',
  'progress',
  'meter',
  'svg',
  'math',
  'mjx-container',
  'canvas',
  'audio',
  'video',
  'iframe',
  'rt',
  'rp',
  'summary',
  'label',
  'code',
  'pre',
  '[hidden]',
  '[inert]',
  '[aria-hidden="true"]',
  '[aria-busy="true"]',
  '[aria-live]:not([aria-live="off"])',
  '[role="status"]',
  '[role="alert"]',
  '[role="log"]',
  '[role="progressbar"]',
  '[role="toolbar"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="tree"]',
  '[role="treeitem"]',
  '[role="grid"]',
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
  '[translate="no"]',
  '.monaco-editor',
  '.cm-editor',
  '.CodeMirror',
  '.MathJax',
  '.katex',
  '.notranslate',
  '.infobox',
  '.navbox',
  '.reflist',
  '.reference',
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
    hasAssignedSlotAncestor(parent) ||
    hasUnassignedShadowHostLightDomAncestor(parent) ||
    hasHiddenAncestor(parent) ||
    hasClosedDetailsAncestor(parent) ||
    hasClosedDialogAncestor(parent) ||
    hasCollapsedAriaPanelAncestor(parent) ||
    hasBootstrapCollapsedAncestor(parent) ||
    hasBootstrapHiddenOverlayAncestor(parent) ||
    hasClosedNativePopoverAncestor(parent) ||
    hasClosedStatefulOverlayAncestor(parent) ||
    hasInactiveAriaTabPanelAncestor(parent) ||
    hasBootstrapInactiveTabPaneAncestor(parent) ||
    hasAccessibleReferenceAncestor(parent) ||
    hasInteractiveSurfaceAncestor(parent)
  );
}

/**
 * Checks whether text belongs to non-rendered fallback content of an assigned slot.
 *
 * @param element Element that owns a text node.
 * @returns True when a containing slot renders assigned light-DOM nodes instead.
 */
export function hasAssignedSlotAncestor(element: HTMLElement): boolean {
  const slot = element.closest('slot');
  if (!(slot instanceof HTMLSlotElement)) {
    return false;
  }

  return slot.assignedNodes().length > 0;
}

/**
 * Checks whether text belongs to light DOM that a shadow host does not render.
 *
 * @param element Element that owns a text node.
 * @returns True when the nearest shadow host has no matching slot for this light-DOM branch.
 */
export function hasUnassignedShadowHostLightDomAncestor(element: HTMLElement): boolean {
  for (let host = element.parentElement; host; host = host.parentElement) {
    if (!host.shadowRoot) {
      continue;
    }

    const directChild = directLightDomChildOfHost(element, host);
    return Boolean(directChild && !assignedSlotOf(directChild));
  }
  return false;
}

/**
 * Finds the direct light-DOM child under a shadow host for a descendant element.
 *
 * @param element Descendant element being checked.
 * @param host Shadow host containing the light-DOM branch.
 * @returns Direct slottable child of the host, or null when not found.
 */
function directLightDomChildOfHost(element: HTMLElement, host: HTMLElement): Element | null {
  let current: Element = element;
  while (current.parentElement && current.parentElement !== host) {
    current = current.parentElement;
  }

  return current.parentElement === host ? current : null;
}

/**
 * Reads assignedSlot from slottable nodes without assuming a specific node subtype.
 *
 * @param node Potential slottable light-DOM node.
 * @returns Assigned slot, or null when the node is not rendered by a slot.
 */
function assignedSlotOf(node: Element): HTMLSlotElement | null {
  return node.assignedSlot;
}

/**
 * Checks text used as the external accessible name or description of controls.
 *
 * @param element Element that owns a text node.
 * @returns True when a control references this subtree via an ARIA idref.
 */
export function hasAccessibleReferenceAncestor(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (!current.id || !isReferencedByInteractiveSurface(current)) {
      continue;
    }

    return true;
  }
  return false;
}

/**
 * Finds referenced text targets affected by an ARIA idref attribute mutation.
 *
 * @param element Element whose ARIA reference attribute changed.
 * @param attributeName Mutated attribute name from MutationObserver.
 * @param previousValue Previous attribute value when available.
 * @returns Referenced elements that may need cleanup or rescan.
 */
export function ariaReferenceTargetsFromMutation(
  element: HTMLElement,
  attributeName: string | null,
  previousValue: string | null
): HTMLElement[] {
  if (!attributeName || !ARIA_REFERENCE_ATTRIBUTES.includes(attributeName)) {
    return [];
  }

  const ids = new Set([...idrefTokens(previousValue ?? ''), ...idrefTokens(element.getAttribute(attributeName) ?? '')]);
  return Array.from(ids)
    .map((id) => element.ownerDocument.getElementById(id))
    .filter((target): target is HTMLElement => target instanceof HTMLElement);
}

/**
 * Checks whether a node is referenced by a nearby interactive element.
 *
 * @param target Referenced element with a stable id.
 * @returns True when an interactive owner uses the target in an ARIA idref list.
 */
function isReferencedByInteractiveSurface(target: HTMLElement): boolean {
  const owners = Array.from(
    target.ownerDocument.querySelectorAll<HTMLElement>('[aria-labelledby], [aria-describedby], [aria-errormessage]')
  );
  return owners.some((owner) => owner !== target && isInteractiveReferenceOwner(owner) && referencesElementId(owner, target.id));
}

/**
 * Checks whether an ARIA reference owner behaves like a control or widget.
 *
 * @param element Element with ARIA idrefs.
 * @returns True when rewriting referenced text could change a control name or description.
 */
function isInteractiveReferenceOwner(element: HTMLElement): boolean {
  return Boolean(
    element.matches(
      [
        'a[href]',
        'button',
        'input',
        'select',
        'textarea',
        'summary',
        '[contenteditable]:not([contenteditable="false"])',
        '[tabindex]',
        '[role]'
      ].join(',')
    ) || element.hasAttribute('onclick')
  );
}

/**
 * Checks whether any supported ARIA idref attribute includes a target id.
 *
 * @param element Element that may reference external text.
 * @param targetId Referenced element id.
 * @returns True when the id appears as a whitespace-separated token.
 */
function referencesElementId(element: HTMLElement, targetId: string): boolean {
  return ARIA_REFERENCE_ATTRIBUTES.some((attribute) => idrefTokens(element.getAttribute(attribute) ?? '').includes(targetId));
}

const ARIA_REFERENCE_ATTRIBUTES = ['aria-labelledby', 'aria-describedby', 'aria-errormessage'];

/**
 * Splits an ARIA idref string into non-empty id tokens.
 *
 * @param value ARIA idref or idref list value.
 * @returns Whitespace-separated id tokens.
 */
function idrefTokens(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

/**
 * Checks whether text belongs to a custom clickable or focusable page widget.
 *
 * @param element Element that owns a text node.
 * @returns True when automatic annotation should yield to the page control.
 */
export function hasInteractiveSurfaceAncestor(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (isCustomInteractiveSurface(current)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks common non-semantic signals used by site-specific controls.
 *
 * @param element Potential custom control container.
 * @returns True when the element is likely to handle page interaction itself.
 */
function isCustomInteractiveSurface(element: HTMLElement): boolean {
  if (element.matches('a[href]')) {
    return false;
  }

  return (
    element.hasAttribute('onclick') ||
    element.hasAttribute('aria-haspopup') ||
    element.hasAttribute('data-action') ||
    element.hasAttribute('data-testid') && hasInteractiveClassOrText(element) ||
    hasKeyboardTabStop(element)
  );
}

/**
 * Checks whether a generic test hook also looks interactive.
 *
 * @param element Element that may be a test-addressed control.
 * @returns True when class/id naming suggests a page action surface.
 */
function hasInteractiveClassOrText(element: HTMLElement): boolean {
  const signal = `${element.id} ${element.className}`.toLowerCase();
  return /\b(button|btn|trigger|toggle|menu|dropdown|action|chip|card)\b/.test(signal);
}

/**
 * Checks whether an element participates in the keyboard tab order.
 *
 * @param element Element with a possible tabindex attribute.
 * @returns True when tabindex is zero or positive.
 */
function hasKeyboardTabStop(element: HTMLElement): boolean {
  const tabindex = element.getAttribute('tabindex');
  if (tabindex === null) {
    return false;
  }

  const parsedTabIndex = Number.parseInt(tabindex, 10);
  return Number.isFinite(parsedTabIndex) && parsedTabIndex >= 0;
}

/**
 * Checks whether an element or one of its ancestors is visually hidden.
 *
 * @param element Element that owns a text node.
 * @returns True when automatic annotation should ignore this subtree.
 */
export function hasHiddenAncestor(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const display = current.style.display.trim().toLowerCase();
    const visibility = current.style.visibility.trim().toLowerCase();
    if (
      display === 'none' ||
      visibility === 'hidden' ||
      visibility === 'collapse' ||
      hasCommonHiddenClass(current) ||
      hasComputedHiddenStyle(current)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks computed CSS that hides an element without using explicit DOM attributes.
 *
 * @param element Element whose computed style should be checked.
 * @returns True when the element is styled as visually unavailable.
 */
function hasComputedHiddenStyle(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view || !hasComputedStyleSignal(element)) {
    return false;
  }
  if (element.hasAttribute('popover') && isNativePopoverOpen(element)) {
    return false;
  }

  const style = view.getComputedStyle(element);
  const display = style.display.trim().toLowerCase();
  const visibility = style.visibility.trim().toLowerCase();
  const opacity = style.opacity.trim();
  if (display === 'none' || visibility === 'hidden' || visibility === 'collapse' || opacity === '0') {
    return true;
  }

  return (
    hasContentHiddenStyle(style) ||
    hasClippedHiddenStyle(style) ||
    hasTransformCollapsedStyle(style) ||
    hasZeroSizeOverflowHiddenStyle(style) ||
    hasOffscreenHiddenStyle(style)
  );
}

/**
 * Checks whether an element has selectors likely to participate in author CSS rules.
 *
 * @param element Element considered for computed style inspection.
 * @returns True when reading computed style is worth the compatibility cost.
 */
function hasComputedStyleSignal(element: HTMLElement): boolean {
  return Boolean(element.className || element.id || element.getAttribute('style') || element.attributes.length);
}

/**
 * Checks CSS containment styles that skip painting a subtree.
 *
 * @param style Computed style for the current element.
 * @returns True when content visibility hides the subtree.
 */
function hasContentHiddenStyle(style: CSSStyleDeclaration): boolean {
  return style.getPropertyValue('content-visibility').trim().toLowerCase() === 'hidden';
}

/**
 * Checks classic screen-reader-only clipping styles.
 *
 * @param style Computed style for the current element.
 * @returns True when clipping makes a tiny element visually unavailable.
 */
function hasClippedHiddenStyle(style: CSSStyleDeclaration): boolean {
  const clip = style.getPropertyValue('clip').trim().toLowerCase();
  const clipPath = style.getPropertyValue('clip-path').trim().toLowerCase();
  if ((!clip || clip === 'auto') && (!clipPath || clipPath === 'none')) {
    return false;
  }

  return numericCssPx(style.width) <= 1 && numericCssPx(style.height) <= 1;
}

/**
 * Checks transform styles that collapse painted content to an invisible point.
 *
 * @param style Computed style for the current element.
 * @returns True when scale transform makes the subtree visually unavailable.
 */
function hasTransformCollapsedStyle(style: CSSStyleDeclaration): boolean {
  const transform = style.transform.trim().toLowerCase();
  return transform === 'scale(0)' || transform === 'scale(0, 0)' || transform === 'matrix(0, 0, 0, 0, 0, 0)';
}

/**
 * Checks virtualizer or measuring rows that collapse text into a zero-size clipped box.
 *
 * @param style Computed style for the current element.
 * @returns True when zero-size overflow clipping makes text visually unavailable.
 */
function hasZeroSizeOverflowHiddenStyle(style: CSSStyleDeclaration): boolean {
  if (!isOverflowClipped(style)) {
    return false;
  }

  return numericCssPx(style.width) === 0 || numericCssPx(style.height) === 0;
}

/**
 * Checks whether overflow clipping can hide collapsed content.
 *
 * @param style Computed style for the current element.
 * @returns True when either axis clips overflowing content.
 */
function isOverflowClipped(style: CSSStyleDeclaration): boolean {
  return (
    style.overflow.trim().toLowerCase() === 'hidden' ||
    style.overflowX.trim().toLowerCase() === 'hidden' ||
    style.overflowY.trim().toLowerCase() === 'hidden' ||
    style.overflow.trim().toLowerCase() === 'clip' ||
    style.overflowX.trim().toLowerCase() === 'clip' ||
    style.overflowY.trim().toLowerCase() === 'clip'
  );
}

/**
 * Checks offscreen utility styles commonly used for hidden assistive text.
 *
 * @param style Computed style for the current element.
 * @returns True when the element is positioned far outside the viewport.
 */
function hasOffscreenHiddenStyle(style: CSSStyleDeclaration): boolean {
  const position = style.position.trim().toLowerCase();
  if (position !== 'absolute' && position !== 'fixed') {
    return false;
  }

  return numericCssPx(style.left) <= -1000 || numericCssPx(style.top) <= -1000;
}

/**
 * Parses a computed pixel value and treats non-pixel values as visible.
 *
 * @param value CSS length value from computed style.
 * @returns Numeric pixel value, or positive infinity when parsing is unsafe.
 */
function numericCssPx(value: string): number {
  const trimmedValue = value.trim().toLowerCase();
  if (!trimmedValue.endsWith('px')) {
    return Number.POSITIVE_INFINITY;
  }

  const parsedValue = Number.parseFloat(trimmedValue);
  return Number.isFinite(parsedValue) ? parsedValue : Number.POSITIVE_INFINITY;
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
    element.classList.contains('is-hidden') ||
    element.classList.contains('visually-hidden') ||
    element.classList.contains('sr-only')
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
 * Checks whether text is inside a Bootstrap overlay that is hidden until `.show`.
 *
 * @param element Element that owns a text node.
 * @returns True when a common Bootstrap overlay container is currently hidden.
 */
export function hasBootstrapHiddenOverlayAncestor(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (
      isBootstrapOverlayContainer(current) &&
      !current.classList.contains('show') &&
      !current.classList.contains('showing')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether an element is a Bootstrap overlay container controlled by visibility classes.
 *
 * @param element Potential Bootstrap overlay container.
 * @returns True when the element matches a known Bootstrap overlay type.
 */
function isBootstrapOverlayContainer(element: HTMLElement): boolean {
  return (
    element.classList.contains('dropdown-menu') ||
    element.classList.contains('modal') ||
    element.classList.contains('offcanvas')
  );
}

/**
 * Checks whether text is inside a native popover that is not currently open.
 *
 * @param element Element that owns a text node.
 * @returns True when the closest native popover is closed.
 */
export function hasClosedNativePopoverAncestor(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (!current.hasAttribute('popover')) {
      continue;
    }

    return !isNativePopoverOpen(current);
  }
  return false;
}

/**
 * Checks whether a native popover is visible in the top layer.
 *
 * @param element Native popover element.
 * @returns True when the popover is currently open.
 */
function isNativePopoverOpen(element: HTMLElement): boolean {
  if (element.getAttribute('data-state') === 'open') {
    return true;
  }

  try {
    return element.matches(':popover-open');
  } catch {
    return false;
  }
}

/**
 * Checks Radix/Headless-style overlay state containers that are mounted while closed.
 *
 * @param element Element that owns a text node.
 * @returns True when a popup-like ancestor is explicitly closed.
 */
export function hasClosedStatefulOverlayAncestor(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.getAttribute('data-state') === 'closed' && isStatefulOverlayContainer(current)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a stateful element looks like mounted overlay content rather than a trigger.
 *
 * @param element Potential popup content container.
 * @returns True when the element matches common overlay content signals.
 */
function isStatefulOverlayContainer(element: HTMLElement): boolean {
  const role = element.getAttribute('role');
  return (
    role === 'dialog' ||
    role === 'menu' ||
    role === 'listbox' ||
    role === 'tooltip' ||
    element.hasAttribute('data-side') ||
    element.hasAttribute('data-align') ||
    element.hasAttribute('popover')
  );
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
    hasBootstrapHiddenOverlayAncestor(element) ||
    hasClosedNativePopoverAncestor(element) ||
    hasClosedStatefulOverlayAncestor(element) ||
    hasInactiveAriaTabPanelAncestor(element) ||
    hasBootstrapInactiveTabPaneAncestor(element) ||
    hasAccessibleReferenceAncestor(element) ||
    hasInteractiveSurfaceAncestor(element)
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
