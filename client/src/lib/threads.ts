/**
 * Turning a flat list of replies into the shape they were written in.
 *
 * Every reply already points at the message it answers, so a side conversation
 * is a tree whether or not anything draws it as one. This flattens that tree
 * back into a reading order — parent, then its answers, then their answers —
 * with a depth on each so the panel can indent it.
 *
 * Kept out of the component so the awkward parts have tests: a reply whose
 * parent is not in the set, two replies written in the same second, and data
 * that points at itself.
 */

/** The only fields the ordering needs; a chat Message satisfies it. */
export type ThreadCandidate = {
  id: string;
  createdAt: Date | string;
  replyTo?: { id: string } | undefined;
};

export type ThreadNode<T> = {
  message: T;
  /** 0 for the root. Indentation, already clamped to something drawable. */
  depth: number;
};

/**
 * How far in a reply is drawn, at most.
 *
 * The tree can be any depth, and on a phone the fourth indent has already
 * eaten the width the message needs. Past this everything sits at the same
 * inset and the quote line above each reply carries the structure instead.
 */
export const MAX_THREAD_DEPTH = 4;

export function buildThreadTree<T extends ThreadCandidate>(root: T, replies: T[]): ThreadNode<T>[] {
  const time = (m: T) => new Date(m.createdAt).getTime();
  // Two messages can share a timestamp to the millisecond; the id keeps the
  // order from wobbling between renders.
  const inOrder = [...replies].sort((a, b) => time(a) - time(b) || a.id.localeCompare(b.id));

  const present = new Set([root.id, ...inOrder.map((m) => m.id)]);
  const childrenOf = new Map<string, T[]>();
  for (const reply of inOrder) {
    const parentId = reply.replyTo?.id;
    // A reply whose parent is not here — answering something older than the
    // thread, or pointing at itself — hangs off the root rather than being
    // dropped. Losing a message to tidy a diagram would be the wrong trade.
    const parent = parentId && parentId !== reply.id && present.has(parentId) ? parentId : root.id;
    const siblings = childrenOf.get(parent);
    if (siblings) siblings.push(reply);
    else childrenOf.set(parent, [reply]);
  }

  const ordered: ThreadNode<T>[] = [];
  const seen = new Set<string>();

  const walk = (message: T, depth: number) => {
    // Guards against a cycle in the data; without it this would not return.
    if (seen.has(message.id)) return;
    seen.add(message.id);
    ordered.push({ message, depth: Math.min(depth, MAX_THREAD_DEPTH) });
    for (const child of childrenOf.get(message.id) ?? []) walk(child, depth + 1);
  };

  walk(root, 0);

  // Anything a cycle kept out still belongs in the thread, at the end.
  for (const reply of inOrder) {
    if (!seen.has(reply.id)) ordered.push({ message: reply, depth: 1 });
  }

  return ordered;
}
