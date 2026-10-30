/**
 * The one line a reply shows of the message it answers.
 *
 * Built in one place because it is assembled twice — once when a page of
 * messages is fetched, once when a reply is broadcast live — and the two
 * drifting apart would mean a quote that looked different before and after a
 * reload.
 *
 * Deliberately raw: the content, type and attachment go over as they are and
 * the client turns them into a line with its own `describeMessage`. Writing a
 * sentence here would mean two sets of preview rules to keep in step.
 */

export type ReplyQuote =
  | { id: string; unavailable: true }
  | {
      id: string;
      senderName: string;
      content: string;
      messageType?: string;
      attachment?: { mimeType: string; name: string };
      deleted: boolean;
    };

type QuotableSource = {
  senderId: unknown;
  content: string;
  messageType?: string;
  attachment?: { mimeType: string; name: string } | null;
  deletedAt?: Date | null;
};

/**
 * `source` is the quoted message, or nothing when it could not be found —
 * cleared by a ghost chat, say, or deleted outright.
 */
export function buildReplyQuote(id: string, source?: QuotableSource | null): ReplyQuote {
  if (!source) return { id, unavailable: true };

  const sender = source.senderId as { name?: string } | string | undefined;
  const deleted = !!source.deletedAt;

  return {
    id,
    senderName: typeof sender === "object" && sender?.name ? sender.name : "Someone",
    // A deleted message's words do not travel, not even inside a quote of it.
    content: deleted ? "" : source.content,
    messageType: source.messageType,
    attachment:
      deleted || !source.attachment
        ? undefined
        : { mimeType: source.attachment.mimeType, name: source.attachment.name },
    deleted,
  };
}
