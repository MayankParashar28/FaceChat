import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Download, ImageOff, Loader2, Pin } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  formatFileSize,
  useAttachmentUrl,
  type ChatAttachmentData,
} from "@/components/ChatAttachment";

/**
 * A run of photos sent together, shown as a pile rather than a column.
 *
 * Sending six pictures used to mean six full-width bubbles, so the rest of the
 * conversation scrolled off the screen and the pictures themselves read as six
 * unrelated events instead of one. Here they land as a stack, keep the height
 * of roughly one message, and scatter into a grid when tapped.
 *
 * The scatter is a layout animation, not hard-coded coordinates: the pile and
 * the grid are two ordinary CSS layouts and framer-motion measures its way
 * between them. That is what makes it survive a narrow bubble on a phone,
 * where any arc of absolute positions wide enough to look good on a desktop
 * would be hanging off the side of the screen.
 */

export type StackPhoto = {
  /** The message this photo arrived on; also what the seen-report is keyed to. */
  messageId: string;
  attachment: ChatAttachmentData;
  /**
   * Pinning no longer breaks a photo out of the pile — doing that split the
   * run either side of it and could cost the whole stack — so the pile has to
   * say which of its cards is pinned.
   */
  isPinned?: boolean;
};

const SPRING = { type: "spring" as const, stiffness: 260, damping: 22, mass: 0.9 };

/**
 * A stable pseudo-random number in [0, 1) for card `i`.
 *
 * The tilt has to be the same on every render: recomputing Math.random() would
 * reshuffle the whole pile each time React re-rendered the message list, which
 * happens on every incoming message.
 */
function jitter(i: number, salt: number): number {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Where card `i` sits relative to where its layout already put it.
 *
 * In the pile every card is handed the same box, so without a nudge they stack
 * exactly on top of each other and five photos look like one. The offset is
 * what makes the corners show; tilt alone was not enough. In the grid the
 * layout does the work, and only a little tilt is left so it does not read as
 * a contact sheet.
 */
function cardPose(i: number, exploded: boolean): { rotate: number; x: number; y: number } {
  if (exploded) {
    return { rotate: (jitter(i, 3) * 2 - 1) * 5, x: 0, y: 0 };
  }
  return {
    rotate: (jitter(i, 1) * 2 - 1) * 14,
    x: (jitter(i, 2) * 2 - 1) * 11,
    y: (jitter(i, 4) * 2 - 1) * 11,
  };
}

function StackPhotoImage({
  photo,
  conversationId,
  onOpen,
  onResolved,
  index,
  exploded,
}: {
  photo: StackPhoto;
  conversationId: string;
  onOpen: () => void;
  onResolved: (url: string) => void;
  index: number;
  exploded: boolean;
}) {
  const { url, failed } = useAttachmentUrl(photo.attachment, conversationId);

  // Hand the resolved URL up so opening the photo full size reuses these bytes.
  // A GridFS attachment is fetched whole and wrapped in a blob URL — there is
  // no smaller thumbnail — so letting the lightbox resolve it again downloaded
  // the entire image a second time to show what was already on screen.
  useEffect(() => {
    if (url) onResolved(url);
  }, [url, onResolved]);

  return (
    <div className="h-full w-full overflow-hidden rounded-[3px] bg-muted">
      {url && !failed ? (
        <img
          src={url}
          alt={photo.attachment.name}
          loading="lazy"
          draggable={false}
          onClick={exploded ? onOpen : undefined}
          className={`h-full w-full object-cover ${exploded ? "cursor-zoom-in" : ""}`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          {failed ? (
            <ImageOff className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          )}
          <span className="sr-only">
            {failed ? `${photo.attachment.name} could not be loaded` : "Loading photo"}
          </span>
        </div>
      )}
      {/* The thick bottom lip is the whole reason a Polaroid reads as one. */}
      <span className="sr-only">
        Photo {index + 1}
        {photo.isPinned ? ", pinned" : ""}
      </span>
    </div>
  );
}

export function PhotoBombStack({
  photos,
  conversationId,
}: {
  photos: StackPhoto[];
  conversationId: string;
}) {
  const [exploded, setExploded] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const reduceMotion = useReducedMotion();

  // Honouring prefers-reduced-motion is the point of the setting, and a pile of
  // photos springing apart is exactly the kind of movement it is set to avoid.
  // The layout still changes; it just arrives instead of travelling.
  const transition = reduceMotion ? { duration: 0 } : SPRING;
  const open = openIndex !== null ? photos[openIndex] : null;

  return (
    <div className="mb-2">
      <div className="relative">
        <motion.div
          layout
          transition={transition}
          className={
            exploded
              ? "grid w-full grid-cols-2 gap-2 sm:grid-cols-3"
              : "relative h-[150px] w-[150px]"
          }
        >
          {photos.map((photo, i) => {
            const pose = cardPose(i, exploded);
            const delay = reduceMotion ? 0 : i * 0.035;
            return (
              <motion.div
                layout
                key={photo.messageId}
                transition={{ ...transition, delay }}
                className={
                  exploded ? "aspect-square" : "absolute inset-0 m-auto h-[112px] w-[112px]"
                }
                style={exploded ? undefined : { zIndex: photos.length - i }}
              >
                {/* The pose rides on an inner element on purpose: a transform
                    set on the element doing the layout animation fights with
                    the one framer-motion applies to move it. */}
                <motion.div
                  animate={reduceMotion ? { rotate: 0, x: 0, y: 0 } : pose}
                  transition={{ ...transition, delay }}
                  className={`relative h-full w-full rounded-[4px] border bg-background p-1.5 pb-4 shadow-md ${
                    photo.isPinned ? "border-chart-2 ring-2 ring-chart-2/40" : "border-border/70"
                  }`}
                >
                  {photo.isPinned && (
                    <span className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-background bg-chart-2 text-background shadow">
                      <Pin className="h-2.5 w-2.5" aria-hidden="true" />
                    </span>
                  )}
                  <StackPhotoImage
                    photo={photo}
                    conversationId={conversationId}
                    index={i}
                    exploded={exploded}
                    onOpen={() => setOpenIndex(i)}
                    onResolved={(url) =>
                      setResolved((prev) =>
                        prev[photo.messageId] === url ? prev : { ...prev, [photo.messageId]: url }
                      )
                    }
                  />
                </motion.div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* The pile itself is the target; asking people to find the caption
            would be missing the point. It goes once scattered, so the photos
            underneath become clickable. */}
        {!exploded && (
          <button
            type="button"
            onClick={() => setExploded(true)}
            aria-label={`Scatter ${photos.length} photos`}
            className="absolute inset-0 z-50 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        )}
      </div>

      <button
        type="button"
        onClick={() => setExploded((v) => !v)}
        aria-expanded={exploded}
        className="mt-2 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {exploded ? "Stack them back" : `${photos.length} photos · tap to scatter`}
      </button>

      <AnimatePresence>
        {open && (
          <Dialog open onOpenChange={() => setOpenIndex(null)}>
            <DialogContent className="max-w-4xl border-border bg-background p-2 sm:p-4">
              {/* Radix requires a title; the filename is shown below instead. */}
              <DialogTitle className="sr-only">{open.attachment.name}</DialogTitle>
              {/* The thumbnail has almost always resolved by now, and reusing
                  its URL means opening a photo costs nothing. */}
              {resolved[open.messageId] ? (
                <LightboxFrame photo={open} url={resolved[open.messageId]} />
              ) : (
                <LightboxImage photo={open} conversationId={conversationId} />
              )}
            </DialogContent>
          </Dialog>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Resolves the photo itself, for the rare open before its thumbnail arrived.
 *
 * Kept as a separate component rather than an `enabled` flag on the hook
 * because a hook cannot be skipped: calling it and ignoring the result still
 * runs the fetch, which is the download this split exists to avoid.
 */
function LightboxImage({ photo, conversationId }: { photo: StackPhoto; conversationId: string }) {
  const { url, failed } = useAttachmentUrl(photo.attachment, conversationId);

  if (failed) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        {photo.attachment.name} could not be loaded.
      </p>
    );
  }
  if (!url) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  return <LightboxFrame photo={photo} url={url} />;
}

function LightboxFrame({ photo, url }: { photo: StackPhoto; url: string }) {
  return (
    <>
      <img
        src={url}
        alt={photo.attachment.name}
        className="max-h-[75vh] w-full rounded-md object-contain"
      />
      <div className="flex items-center justify-between gap-3 px-1 pt-1">
        <span className="min-w-0 truncate text-sm text-muted-foreground">
          {photo.attachment.name} · {formatFileSize(photo.attachment.size)}
        </span>
        <a
          href={url}
          download={photo.attachment.name}
          className="flex shrink-0 items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          <Download className="h-4 w-4" />
          Download
        </a>
      </div>
    </>
  );
}
