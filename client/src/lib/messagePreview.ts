/**
 * Describing a message in one line, for places that cannot show the message.
 *
 * The pinned bar, and the conversation list before it, printed `msg.content`
 * raw. That reads fine for text and badly for everything else: an uploaded
 * photo carries the file name in `content`, so pinning one put a naked
 * `IMG_4821.jpg` at the top of the thread with nothing to say it was a
 * picture — and a photo someone had captioned looked exactly the same as one
 * they had not.
 *
 * Kept out of the component so the rules can be tested without a DOM.
 */

/** The only part of an attachment a preview looks at. */
type PreviewAttachment = { mimeType: string; name: string };

export type MessagePreviewCandidate = {
  content: string;
  messageType?: string;
  attachment?: PreviewAttachment;
};

export type MessagePreview = {
  /** What to draw beside the text. The caller owns the icons. */
  kind: "photo" | "file" | "system" | "text";
  /** One line, already chosen between caption and file name. */
  label: string;
  /** The file name, when there is one and the label is not already it. */
  detail?: string;
};

/**
 * Whether the uploader actually wrote something.
 *
 * The upload path puts the file name in `content` when nobody typed a caption,
 * so equality with the name is how a real caption is told from a placeholder.
 */
function caption(msg: MessagePreviewCandidate): string | undefined {
  const name = msg.attachment?.name;
  const written = msg.content?.trim();
  if (!written || written === name) return undefined;
  return written;
}

export function describeMessage(msg: MessagePreviewCandidate): MessagePreview {
  if (msg.messageType === "system") {
    return { kind: "system", label: msg.content };
  }

  const attachment = msg.attachment;
  if (attachment) {
    const written = caption(msg);
    const isPhoto = attachment.mimeType?.startsWith("image/");
    if (isPhoto) {
      // A captioned photo leads with what was said; the file name follows it,
      // because the caption is the part worth reading.
      return { kind: "photo", label: written || "Photo", detail: attachment.name };
    }
    return written
      ? { kind: "file", label: written, detail: attachment.name }
      : { kind: "file", label: attachment.name };
  }

  // An empty text message should still occupy its line rather than collapse.
  return { kind: "text", label: msg.content?.trim() || "Message" };
}
