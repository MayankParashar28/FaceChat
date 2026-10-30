import { describe, it, expect } from "vitest";
import {
  canDelete,
  canEdit,
  validateEdit,
  EDIT_WINDOW_MS,
  MAX_MESSAGE_LENGTH,
} from "../../server/services/messageEdits";

const AUTHOR = "author-id";
const OTHER = "someone-else";

const message = (over: Partial<Parameters<typeof canEdit>[0]> = {}) => ({
  senderId: AUTHOR,
  createdAt: new Date(),
  ...over,
});

describe("canEdit", () => {
  it("lets the author rewrite what they just sent", () => {
    expect(canEdit(message(), AUTHOR)).toEqual({ ok: true });
  });

  it("refuses anyone else", () => {
    const verdict = canEdit(message(), OTHER);

    expect(verdict.ok).toBe(false);
    expect(verdict).toHaveProperty("reason", "You can only edit your own messages.");
  });

  it("refuses a message that was deleted", () => {
    expect(canEdit(message({ deletedAt: new Date() }), AUTHOR).ok).toBe(false);
  });

  it("refuses one carrying a file, whose caption would stop describing it", () => {
    expect(canEdit(message({ attachment: { name: "a.jpg" } }), AUTHOR).ok).toBe(false);
  });

  it("closes the window once it has passed", () => {
    const old = message({ createdAt: new Date(Date.now() - EDIT_WINDOW_MS - 1000) });

    expect(canEdit(old, AUTHOR).ok).toBe(false);
  });

  it("is still open on the last millisecond of it", () => {
    const now = Date.now();
    const edge = message({ createdAt: new Date(now - EDIT_WINDOW_MS) });

    expect(canEdit(edge, AUTHOR, now).ok).toBe(true);
  });
});

describe("validateEdit", () => {
  it("accepts ordinary text", () => {
    expect(validateEdit("fixed the typo")).toEqual({ ok: true });
  });

  it("refuses an empty edit and points at delete instead", () => {
    const verdict = validateEdit("   ");

    expect(verdict.ok).toBe(false);
    expect(verdict).toHaveProperty("reason", expect.stringContaining("Delete it instead"));
  });

  it("refuses something that is not a string", () => {
    // A client can send anything; mongoose would cast a number to text.
    expect(validateEdit(42).ok).toBe(false);
  });

  it("refuses more than the composer would send", () => {
    expect(validateEdit("a".repeat(MAX_MESSAGE_LENGTH + 1)).ok).toBe(false);
    expect(validateEdit("a".repeat(MAX_MESSAGE_LENGTH)).ok).toBe(true);
  });
});

describe("canDelete", () => {
  it("lets the author take back something old, unlike editing", () => {
    const ancient = message({ createdAt: new Date(Date.now() - EDIT_WINDOW_MS * 100) });

    expect(canEdit(ancient, AUTHOR).ok).toBe(false);
    expect(canDelete(ancient, AUTHOR)).toEqual({ ok: true });
  });

  it("refuses to let one person delete the other's message", () => {
    expect(canDelete(message(), OTHER).ok).toBe(false);
  });

  it("refuses a second deletion", () => {
    expect(canDelete(message({ deletedAt: new Date() }), AUTHOR).ok).toBe(false);
  });

  it("allows deleting a message with a file on it", () => {
    expect(canDelete(message({ attachment: { name: "a.jpg" } }), AUTHOR)).toEqual({ ok: true });
  });
});
