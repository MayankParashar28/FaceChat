import { CornerUpLeft, ImageIcon, FileText, Trash2 } from "lucide-react";
import { describeMessage } from "@/lib/messagePreview";

/**
 * The line of quoted message that sits above a reply.
 *
 * Shows one line and no more: a quote that reproduces the whole of a long
 * message pushes the reply itself off the screen, which is the opposite of
 * what quoting is for. The rules for turning a message into that line are
 * `describeMessage`'s, the same ones the pinned list uses, so a quoted photo
 * reads "Photo" in both places rather than as a bare file name in one.
 */

export type ReplyQuoteData =
  | { id: string; unavailable: true }
  | {
      id: string;
      senderName: string;
      content: string;
      messageType?: string;
      attachment?: { mimeType: string; name: string };
      deleted: boolean;
    };

export function ReplyQuoteBlock({
  quote,
  isMine,
  onJump,
}: {
  quote: ReplyQuoteData;
  isMine: boolean;
  onJump: (messageId: string) => void;
}) {
  // The accent bar picks up the bubble it sits in, so a quote inside your own
  // message does not look like a foreign object dropped into it.
  const bar = isMine ? "border-primary/40" : "border-muted-foreground/30";

  if ("unavailable" in quote) {
    return (
      <div className={`mb-2 border-l-2 ${bar} pl-2 text-xs text-muted-foreground italic`}>
        Original message is no longer available
      </div>
    );
  }

  if (quote.deleted) {
    return (
      <div
        className={`mb-2 flex items-center gap-1.5 border-l-2 ${bar} pl-2 text-xs italic text-muted-foreground`}
      >
        <Trash2 className="h-3 w-3 shrink-0" aria-hidden="true" />
        Deleted message
      </div>
    );
  }

  const preview = describeMessage(quote);
  const Icon =
    preview.kind === "photo" ? ImageIcon : preview.kind === "file" ? FileText : CornerUpLeft;

  return (
    <button
      type="button"
      onClick={() => onJump(quote.id)}
      className={`mb-2 flex w-full items-start gap-1.5 border-l-2 ${bar} pl-2 text-left transition-colors hover:border-l-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    >
      <Icon className="mt-0.5 h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium opacity-80">{quote.senderName}</span>
        <span className="block truncate text-xs opacity-70">{preview.label}</span>
      </span>
    </button>
  );
}
