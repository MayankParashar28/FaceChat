import { describe, it, expect } from "vitest";
import { buildThreadTree, MAX_THREAD_DEPTH } from "../../client/src/lib/threads";

const T0 = new Date("2026-10-30T12:00:00.000Z").getTime();
const at = (seconds: number) => new Date(T0 + seconds * 1000);

/** `to` is the message this one answers. */
const msg = (id: string, seconds: number, to?: string) => ({
  id,
  createdAt: at(seconds),
  replyTo: to ? { id: to } : undefined,
});

const shape = (nodes: ReturnType<typeof buildThreadTree>) =>
  nodes.map((n) => `${"  ".repeat(n.depth)}${n.message.id}`);

describe("buildThreadTree", () => {
  it("puts a flat set of answers under the root", () => {
    const root = msg("root", 0);
    const tree = buildThreadTree(root, [msg("a", 1, "root"), msg("b", 2, "root")]);

    expect(shape(tree)).toEqual(["root", "  a", "  b"]);
  });

  it("follows a chain down", () => {
    const root = msg("root", 0);
    const tree = buildThreadTree(root, [msg("a", 1, "root"), msg("b", 2, "a"), msg("c", 3, "b")]);

    expect(shape(tree)).toEqual(["root", "  a", "    b", "      c"]);
  });

  it("reads a branch to its end before starting the next", () => {
    // Written interleaved; read as two conversations, not one zigzag.
    const root = msg("root", 0);
    const tree = buildThreadTree(root, [
      msg("a", 1, "root"),
      msg("b", 2, "root"),
      msg("a2", 3, "a"),
      msg("b2", 4, "b"),
    ]);

    expect(shape(tree)).toEqual(["root", "  a", "    a2", "  b", "    b2"]);
  });

  it("orders answers to the same message by when they were written", () => {
    const root = msg("root", 0);
    const tree = buildThreadTree(root, [msg("late", 9, "root"), msg("early", 1, "root")]);

    expect(shape(tree)).toEqual(["root", "  early", "  late"]);
  });

  it("keeps a reply whose parent is not in the thread", () => {
    // Answering something older than the root, say. Dropping it to keep the
    // diagram tidy would lose a message someone wrote.
    const root = msg("root", 0);
    const tree = buildThreadTree(root, [msg("orphan", 1, "somewhere-else")]);

    expect(shape(tree)).toEqual(["root", "  orphan"]);
  });

  it("stops indenting past the limit", () => {
    const root = msg("root", 0);
    const chain = Array.from({ length: MAX_THREAD_DEPTH + 3 }, (_, i) =>
      msg(`n${i}`, i + 1, i === 0 ? "root" : `n${i - 1}`)
    );
    const tree = buildThreadTree(root, chain);

    expect(Math.max(...tree.map((n) => n.depth))).toBe(MAX_THREAD_DEPTH);
    // Everything is still there, just no longer stepping further right.
    expect(tree).toHaveLength(chain.length + 1);
  });

  it("does not hang on a message that answers itself", () => {
    const root = msg("root", 0);
    const tree = buildThreadTree(root, [msg("self", 1, "self")]);

    expect(shape(tree)).toEqual(["root", "  self"]);
  });

  it("survives a cycle between two messages without losing either", () => {
    const root = msg("root", 0);
    const tree = buildThreadTree(root, [msg("x", 1, "y"), msg("y", 2, "x")]);

    expect(tree).toHaveLength(3);
    expect(tree.map((n) => n.message.id).sort()).toEqual(["root", "x", "y"]);
  });

  it("gives back just the root when nobody answered", () => {
    const root = msg("root", 0);

    expect(shape(buildThreadTree(root, []))).toEqual(["root"]);
  });
});
