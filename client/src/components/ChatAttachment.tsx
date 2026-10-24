import { useEffect, useState } from "react";
import { Download, FileText, ImageOff, Loader2 } from "lucide-react";
import { getAuthToken } from "@/lib/queryClient";

export type ChatAttachmentData = {
  provider: "cloudinary" | "gridfs";
  /** Cloudinary public id, or the GridFS file id. */
  storageId: string;
  resourceType?: string;
  name: string;
  size: number;
  mimeType: string;
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Resolve an attachment to a URL the browser can load directly.
 *
 * Cloudinary: ask the server to sign a delivery URL (it checks we are a
 * participant first), then hand that URL straight to the element. The bytes
 * come from the CDN, already resized and in a modern format, and never pass
 * through our own server.
 *
 * GridFS: there is no CDN to point at, so fetch the bytes with the auth header
 * and wrap them in a blob URL. A browser will not attach an Authorization
 * header to `<img src>`, and putting the token in the URL would leak a
 * credential into history, referrer headers and logs.
 */
function useAttachmentUrl(attachment: ChatAttachmentData, conversationId: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      try {
        const token = await getAuthToken();
        const authHeader = token ? { Authorization: `Bearer ${token}` } : undefined;

        if (attachment.provider === "cloudinary") {
          const params = new URLSearchParams({
            publicId: attachment.storageId,
            conversationId,
            resourceType: attachment.resourceType || "image",
          });
          const res = await fetch(`/api/attachments/signed-url?${params}`, {
            headers: authHeader,
          });
          if (!res.ok) throw new Error(`Could not sign attachment URL: ${res.status}`);
          const { url: signed } = await res.json();
          if (cancelled) return;
          setUrl(signed);
          return;
        }

        const res = await fetch(`/api/attachments/${attachment.storageId}`, {
          headers: authHeader,
        });
        if (!res.ok) throw new Error(`Attachment request failed: ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.provider, attachment.storageId, attachment.resourceType, conversationId]);

  return { url, failed };
}

export function ChatAttachment({
  attachment,
  conversationId,
}: {
  attachment: ChatAttachmentData;
  conversationId: string;
}) {
  const { url, failed } = useAttachmentUrl(attachment, conversationId);
  const isImage = attachment.mimeType.startsWith("image/");

  if (failed) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-background/60 p-2.5 text-xs text-muted-foreground">
        <ImageOff className="h-4 w-4 shrink-0" />
        <span className="truncate">{attachment.name} could not be loaded</span>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-background/60 p-2.5 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span className="truncate">Loading {attachment.name}…</span>
      </div>
    );
  }

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mb-2 block">
        <img
          src={url}
          alt={attachment.name}
          loading="lazy"
          className="max-h-64 w-auto rounded-lg border border-border object-cover"
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      download={attachment.name}
      className="mb-2 flex items-center gap-3 rounded-lg border border-border bg-background/60 p-2.5 transition-colors hover:bg-accent"
    >
      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{attachment.name}</span>
        <span className="block text-xs text-muted-foreground">
          {formatFileSize(attachment.size)}
        </span>
      </span>
      <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
    </a>
  );
}
