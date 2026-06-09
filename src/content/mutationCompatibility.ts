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

/**
 * Detects QianCi-owned nodes in a mutation node list.
 *
 * @param nodes Nodes added or removed by a mutation record.
 * @returns True when any node belongs to QianCi markup.
 */
export function containsQianciOwnedNode(nodes: Node[]): boolean {
  return nodes.some((node) => {
    if (node.nodeType !== 1) {
      return false;
    }

    const element = node as Element;
    return Boolean(
      element.matches('[data-qianci-word], [data-qianci-tooltip], [data-qianci-style]') ||
        element.querySelector('[data-qianci-word], [data-qianci-tooltip], [data-qianci-style]')
    );
  });
}

/**
 * Checks whether a mutation is caused by QianCi-owned UI or annotation nodes.
 *
 * @param mutation Mutation record from the observed page root.
 * @returns True when the mutation should not count as page churn.
 */
export function isQianciOwnedMutation(mutation: MutationRecord): boolean {
  const target = mutation.target;
  const element = target.nodeType === 1 ? (target as Element) : (target.parentElement as Element | null);
  return Boolean(element?.closest('[data-qianci-word], [data-qianci-tooltip], [data-qianci-style]'));
}
