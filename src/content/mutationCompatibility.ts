export interface AnnotationDetectionOptions {
  includeSelf?: boolean;
}

/**
 * Detects QianCi annotation elements in mutation record nodes.
 *
 * @param nodes Mutation nodes to inspect.
 * @param options Detection options for self versus descendant checks.
 * @returns True when the node list includes QianCi annotation markup.
 */
export function containsQianciAnnotation(nodes: Node[], options: AnnotationDetectionOptions = {}): boolean {
  const includeSelf = options.includeSelf ?? true;
  return nodes.some((node) => {
    if (node.nodeType !== 1) {
      return false;
    }

    const element = node as Element;
    return (
      (includeSelf && Boolean((element as HTMLElement).dataset.qianciWord)) ||
      Boolean(element.querySelector('[data-qianci-word]'))
    );
  });
}
