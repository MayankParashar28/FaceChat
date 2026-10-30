import { describe, it, expect } from "vitest";
import { planConversationCleanup, emptyReport } from "../../server/services/accountDeletion";

const live = (...ids: string[]) => new Set(ids);

describe("planConversationCleanup", () => {
  it("takes the leaver out of a chat someone else is still in", () => {
    const [verdict] = planConversationCleanup(
      [{ id: "c1", participants: ["me", "them"] }],
      "me",
      live("them")
    );
    expect(verdict).toEqual({ id: "c1", action: "detach", remaining: ["them"] });
  });

  it("removes a one-to-one chat once both sides are gone", () => {
    const [verdict] = planConversationCleanup(
      [{ id: "c1", participants: ["me", "ghost"] }],
      "me",
      live()
    );
    expect(verdict).toEqual({ id: "c1", action: "delete" });
  });

  it("keeps a group that still has two live members", () => {
    const [verdict] = planConversationCleanup(
      [{ id: "g", participants: ["me", "a", "b"] }],
      "me",
      live("a", "b")
    );
    expect(verdict).toEqual({ id: "g", action: "detach", remaining: ["a", "b"] });
  });

  it("removes a group whose every other member was already deleted", () => {
    const [verdict] = planConversationCleanup(
      [{ id: "g", participants: ["me", "ghost1", "ghost2"] }],
      "me",
      live()
    );
    expect(verdict).toEqual({ id: "g", action: "delete" });
  });

  it("does not count a dead participant towards keeping a chat alive", () => {
    const [verdict] = planConversationCleanup(
      [{ id: "c", participants: ["me", "ghost", "alive"] }],
      "me",
      live("alive")
    );
    expect(verdict).toEqual({ id: "c", action: "detach", remaining: ["alive"] });
  });

  it("removes a chat the leaver was somehow alone in", () => {
    const [verdict] = planConversationCleanup([{ id: "c", participants: ["me"] }], "me", live());
    expect(verdict).toEqual({ id: "c", action: "delete" });
  });

  it("removes a chat with no participants at all", () => {
    const [verdict] = planConversationCleanup([{ id: "c", participants: [] }], "me", live("other"));
    expect(verdict).toEqual({ id: "c", action: "delete" });
  });

  it("never leaves the departing account among the remaining", () => {
    const verdicts = planConversationCleanup(
      [{ id: "c", participants: ["me", "me", "them"] }],
      "me",
      live("me", "them")
    );
    expect(verdicts[0]).toEqual({ id: "c", action: "detach", remaining: ["them"] });
  });

  it("decides each conversation on its own", () => {
    const verdicts = planConversationCleanup(
      [
        { id: "keep", participants: ["me", "them"] },
        { id: "drop", participants: ["me", "ghost"] },
      ],
      "me",
      live("them")
    );
    expect(verdicts.map((v) => v.action)).toEqual(["detach", "delete"]);
  });

  it("handles having nothing to decide", () => {
    expect(planConversationCleanup([], "me", live("them"))).toEqual([]);
  });
});

describe("emptyReport", () => {
  it("starts every tally at nothing", () => {
    const report = emptyReport();
    const counts = Object.entries(report).filter(([, v]) => typeof v === "number");
    expect(counts.length).toBeGreaterThan(8);
    expect(counts.every(([, v]) => v === 0)).toBe(true);
    expect(report.firebaseUserDeleted).toBe(false);
  });

  it("hands back a fresh object each time", () => {
    const a = emptyReport();
    a.messagesDeleted = 5;
    expect(emptyReport().messagesDeleted).toBe(0);
  });
});
