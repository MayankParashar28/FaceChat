/**
 * How many messages a conversation may keep pinned, and which lose the place.
 *
 * A pinned list is only useful while it is short: once everything is pinned,
 * nothing is. Rather than refuse the pin — which would stop someone mid-thought
 * and send them off to unpin something first — the oldest pin steps aside, and
 * the person who pinned is told which one did. The message itself is untouched
 * and still in the conversation, so nothing is lost by it.
 *
 * Kept apart from the socket handler so the ordering can be tested directly;
 * getting it wrong would quietly drop the wrong person's pin.
 */

/** Three, as on WhatsApp. Past that the bar stops being a summary. */
export const PIN_LIMIT = 3;

/** The part of a pinned message the rule looks at. */
export type PinnedRecord = {
  pinnedAt?: Date | null;
  createdAt: Date;
};

/**
 * The pins that must give way, oldest first.
 *
 * Ordered by when each was pinned, falling back to when the message was sent
 * for pins made before that was recorded — otherwise an old pin with no
 * `pinnedAt` would sort as if it had just happened and evict a fresh one.
 */
export function pinsToEvict<T extends PinnedRecord>(pinned: T[], limit = PIN_LIMIT): T[] {
  if (pinned.length <= limit) return [];

  const when = (p: T) => new Date(p.pinnedAt ?? p.createdAt).getTime();
  // Newest first, so everything past the limit is what has to go.
  return [...pinned].sort((a, b) => when(b) - when(a)).slice(limit);
}
