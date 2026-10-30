import { describe, it, expect } from "vitest";
import {
  groupPhotoBombs,
  PHOTO_BOMB_MIN,
  PHOTO_BOMB_WINDOW_MS,
  type PhotoBombCandidate,
} from "../../client/src/lib/photoBombs";

const T0 = new Date("2026-10-30T12:00:00.000Z").getTime();

/** A photo message as the uploader sends it: caption is the file name. */
function photo(id: string, opts: Partial<PhotoBombCandidate> & { at?: number } = {}) {
  const name = `${id}.jpg`;
  return {
    id,
    content: name,
    isPinned: false,
    createdAt: new Date(opts.at ?? T0),
    attachment: { mimeType: "image/jpeg", name },
    sender: { id: "alice" },
    ...opts,
  } as PhotoBombCandidate;
}

function text(id: string, at = T0) {
  return {
    id,
    content: "hello",
    isPinned: false,
    createdAt: new Date(at),
    sender: { id: "alice" },
  } as PhotoBombCandidate;
}

describe("groupPhotoBombs", () => {
  it("folds a burst into the first message of it", () => {
    const { leads, folded } = groupPhotoBombs([photo("a"), photo("b"), photo("c")]);

    expect([...leads.keys()]).toEqual(["a"]);
    expect(leads.get("a")!.members.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect([...folded.entries()]).toEqual([
      ["b", "a"],
      ["c", "a"],
    ]);
  });

  it("leaves a run shorter than the minimum alone", () => {
    const run = Array.from({ length: PHOTO_BOMB_MIN - 1 }, (_, i) => photo(`p${i}`));
    const { leads, folded } = groupPhotoBombs(run);

    expect(leads.size).toBe(0);
    expect(folded.size).toBe(0);
  });

  it("does not reach across a message that is not a photo", () => {
    // Two photos, a text, two photos: neither side is a burst on its own.
    const { leads } = groupPhotoBombs([photo("a"), photo("b"), text("t"), photo("c"), photo("d")]);

    expect(leads.size).toBe(0);
  });

  it("starts a new burst when the sender changes", () => {
    const { leads, folded } = groupPhotoBombs([
      photo("a"),
      photo("b"),
      photo("c", { sender: { id: "bob" } }),
      photo("d", { sender: { id: "bob" } }),
      photo("e", { sender: { id: "bob" } }),
    ]);

    expect([...leads.keys()]).toEqual(["c"]);
    expect(leads.get("c")!.members.map((m) => m.id)).toEqual(["c", "d", "e"]);
    // a and b were only two, so they stay as they are.
    expect(folded.has("a")).toBe(false);
    expect(folded.has("b")).toBe(false);
  });

  it("splits a run that pauses for longer than the window", () => {
    const later = T0 + PHOTO_BOMB_WINDOW_MS + 1;
    const { leads } = groupPhotoBombs([
      photo("a"),
      photo("b"),
      photo("c"),
      photo("d", { at: later }),
      photo("e", { at: later }),
      photo("f", { at: later }),
    ]);

    expect([...leads.keys()]).toEqual(["a", "d"]);
  });

  it("keeps a run together right up to the edge of the window", () => {
    const { leads } = groupPhotoBombs([
      photo("a"),
      photo("b", { at: T0 + PHOTO_BOMB_WINDOW_MS }),
      photo("c", { at: T0 + PHOTO_BOMB_WINDOW_MS * 2 }),
    ]);

    // Each gap is measured against the previous photo, not the first.
    expect(leads.get("a")!.members.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("will not swallow a photo someone captioned", () => {
    const { leads } = groupPhotoBombs([
      photo("a"),
      photo("b", { content: "look at this one" }),
      photo("c"),
    ]);

    expect(leads.size).toBe(0);
  });

  it("keeps a pinned photo in the pile", () => {
    const { leads } = groupPhotoBombs([photo("a"), photo("b", { isPinned: true }), photo("c")]);

    // Breaking it out split the run either side of it, and a run of five
    // lost its whole pile to one pin.
    expect(leads.get("a")!.members.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("does not let a pin in the middle shatter a longer run", () => {
    const { leads } = groupPhotoBombs([
      photo("a"),
      photo("b"),
      photo("c", { isPinned: true }),
      photo("d"),
      photo("e"),
    ]);

    expect([...leads.keys()]).toEqual(["a"]);
    expect(leads.get("a")!.members).toHaveLength(5);
  });

  it("ignores non-image attachments", () => {
    const pdf = photo("b", { attachment: { mimeType: "application/pdf", name: "b.jpg" } });
    const { leads } = groupPhotoBombs([photo("a"), pdf, photo("c")]);

    expect(leads.size).toBe(0);
  });

  it("handles several bursts in one conversation", () => {
    const later = T0 + PHOTO_BOMB_WINDOW_MS * 10;
    const { leads, folded } = groupPhotoBombs([
      text("t1"),
      photo("a"),
      photo("b"),
      photo("c"),
      photo("d"),
      text("t2", later),
      photo("e", { at: later }),
      photo("f", { at: later }),
      photo("g", { at: later }),
    ]);

    expect([...leads.keys()]).toEqual(["a", "e"]);
    expect(leads.get("a")!.members).toHaveLength(4);
    expect(leads.get("e")!.members).toHaveLength(3);
    expect(folded.size).toBe(5);
  });

  it("steps over a deleted photo instead of splitting the pile", () => {
    // Treating it as an interruption would leave two runs of two, and a
    // single deletion would scatter a burst of five.
    const { leads, folded } = groupPhotoBombs([
      photo("a"),
      photo("b"),
      photo("gone", { deletedAt: new Date() }),
      photo("c"),
      photo("d"),
    ]);

    expect(leads.get("a")!.members.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
    // The deleted one is not folded away either: it draws its own tombstone.
    expect(folded.has("gone")).toBe(false);
  });

  it("returns nothing for an empty conversation", () => {
    const { leads, folded } = groupPhotoBombs([]);
    expect(leads.size).toBe(0);
    expect(folded.size).toBe(0);
  });
});
