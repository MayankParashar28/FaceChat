/**
 * Deciding which photos were sent as one burst.
 *
 * The attachment endpoint takes a single file per request, so picking six
 * photos produces six messages and, until this existed, six full-width
 * bubbles that pushed the rest of the conversation off the screen. Grouping
 * happens at render time rather than in the schema: the messages stay exactly
 * what they are on the server, and showing them individually again is a matter
 * of not calling this.
 *
 * Kept apart from the component that draws the stack so it can be tested
 * without a DOM — the rules below are the part with edge cases in it.
 */

/** The only part of an attachment the grouping rules look at. */
type PhotoAttachment = { mimeType: string; name: string };

/** The shape `groupPhotoBombs` needs; the chat's own Message satisfies it. */
export type PhotoBombCandidate = {
  id: string;
  content: string;
  isPinned: boolean;
  createdAt: Date | string;
  messageType?: string;
  attachment?: PhotoAttachment;
  deletedAt?: string | Date | null;
  sender: { id: string };
};

/** Below this a pile reads as a mistake, so the photos stay normal bubbles. */
export const PHOTO_BOMB_MIN = 3;

/**
 * Photos further apart than this were two thoughts rather than one burst, so
 * they stay separate however many there are.
 */
export const PHOTO_BOMB_WINDOW_MS = 2 * 60 * 1000;

export type PhotoBombs<T> = {
  /** Keyed by the first message of a burst, which draws the whole stack. */
  leads: Map<string, { members: T[] }>;
  /** Every other message of a burst, pointing at the lead that drew it. */
  folded: Map<string, string>;
};

/**
 * A message belongs in a pile only if nothing about it is worth reading on
 * its own: it is an image, and its caption is still the file name the
 * uploader put there. A photo someone wrote a caption for is making a point
 * that a pile would swallow.
 *
 * Pinning deliberately does not break a photo out. It used to, and the cost
 * was out of all proportion: pinning the middle photo of a run of five split
 * it into two runs of two, neither of which clears the minimum, so one tap
 * exploded the whole pile into separate bubbles. Pinning is also something
 * done to a message later, by either person, rather than something the
 * uploader decided — so the pile stays, and the pinned card is marked inside
 * it.
 */
function stackable(msg: PhotoBombCandidate): boolean {
  return (
    msg.messageType !== "system" &&
    !!msg.attachment?.mimeType?.startsWith("image/") &&
    msg.content === msg.attachment.name
  );
}

export function groupPhotoBombs<T extends PhotoBombCandidate>(messages: T[]): PhotoBombs<T> {
  const leads: PhotoBombs<T>["leads"] = new Map();
  const folded: PhotoBombs<T>["folded"] = new Map();
  let run: T[] = [];

  const flush = () => {
    if (run.length >= PHOTO_BOMB_MIN) {
      const lead = run[0];
      leads.set(lead.id, { members: run });
      for (const m of run.slice(1)) folded.set(m.id, lead.id);
    }
    run = [];
  };

  for (const msg of messages) {
    // A deleted photo is stepped over rather than treated as an interruption.
    // Ending the run here would split a burst of five either side of it and
    // leave two runs of two, neither of which clears the minimum — one
    // deletion would take the whole pile apart, which is exactly what pinning
    // used to do.
    if (msg.deletedAt) continue;

    if (!stackable(msg)) {
      flush();
      continue;
    }

    const prev = run[run.length - 1];
    const sameBurst =
      !prev ||
      (prev.sender.id === msg.sender.id &&
        new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() <=
          PHOTO_BOMB_WINDOW_MS);
    // A photo that does not continue the run still starts one of its own.
    if (!sameBurst) flush();
    run.push(msg);
  }
  flush();

  return { leads, folded };
}
