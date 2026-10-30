/**
 * What a file actually is, judged from its bytes.
 *
 * The upload endpoint used to take the caller's word for it: the type arrived
 * as a `?type=` query parameter and was checked against an allow-list, so any
 * file at all could be stored — and later served back — as `image/png`. The
 * allow-list looked like a restriction while enforcing nothing.
 *
 * These are the magic numbers for the handful of formats we accept. Office's
 * modern formats are zip containers and its legacy ones are OLE2 compound
 * files, so several MIME types share one signature; that is as precise as a
 * byte check gets, and it still rules out everything we care about.
 */

/** Types we are willing to store and serve back to a browser. */
export const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export type FileKind =
  "jpeg" | "png" | "gif" | "webp" | "pdf" | "zip" | "ole2" | "text" | "unknown";

const startsWith = (buf: Buffer, bytes: number[]) =>
  buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);

/** Text has no signature, so it is defined by what it must not contain. */
function looksLikeText(buf: Buffer): boolean {
  // A NUL byte is the cheap, decisive tell for binary content.
  if (buf.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

export function sniffFileKind(buf: Buffer): FileKind {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpeg";
  if (
    startsWith(buf, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(buf, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "gif";
  }
  // RIFF....WEBP — the size field sits between the two tags.
  if (
    startsWith(buf, [0x52, 0x49, 0x46, 0x46]) &&
    buf.length >= 12 &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (
    startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(buf, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(buf, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return "zip";
  }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole2";
  if (looksLikeText(buf)) return "text";
  return "unknown";
}

/**
 * Which byte signatures are acceptable for a declared type.
 *
 * The Office entries are deliberately loose. A .docx is a zip, a .doc is OLE2,
 * and Word and Excel will both happily save XML under the legacy extension —
 * so a legitimate file can arrive as any of the three. Being stricter here
 * would reject real documents to no benefit, since none of those shapes is
 * dangerous to store.
 */
const ACCEPTABLE: Record<string, FileKind[]> = {
  "image/jpeg": ["jpeg"],
  "image/png": ["png"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "text/plain": ["text"],
  "text/csv": ["text"],
  "application/zip": ["zip"],
  "application/msword": ["ole2", "zip", "text"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["zip"],
  "application/vnd.ms-excel": ["ole2", "zip", "text"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["zip"],
};

/**
 * Whether the bytes back up the declared MIME type. An unknown type, or one we
 * have no signature rule for, is refused rather than waved through.
 */
export function bytesMatchDeclaredMime(mimeType: string, buf: Buffer): boolean {
  const acceptable = ACCEPTABLE[mimeType];
  if (!acceptable) return false;
  return acceptable.includes(sniffFileKind(buf));
}
