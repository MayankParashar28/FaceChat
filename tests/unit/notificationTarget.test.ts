import { describe, expect, it } from "vitest";
import { notificationPath, type RelatedThing } from "../../server/services/notificationTarget";

describe("notificationPath", () => {
  it("opens the conversation a GhostLink notification names", () => {
    expect(notificationPath({ kind: "conversation", id: "abc123" })).toBe("/chats?id=abc123");
  });

  it("answers a missed call in the chat the call came from", () => {
    const missed: RelatedThing = {
      kind: "meeting",
      roomId: "650000000000000000000001",
      status: "ended",
      roomIsConversation: true,
    };
    expect(notificationPath(missed)).toBe("/chats?id=650000000000000000000001");
  });

  it("joins a standalone meeting that is happening now", () => {
    expect(
      notificationPath({
        kind: "meeting",
        roomId: "room-xyz",
        status: "active",
        roomIsConversation: false,
      })
    ).toBe("/call/room-xyz");
  });

  it("sends a meeting that has not started to the meeting list", () => {
    expect(
      notificationPath({
        kind: "meeting",
        roomId: "room-xyz",
        status: "scheduled",
        roomIsConversation: false,
      })
    ).toBe("/meetings");
  });

  it("sends a standalone meeting that is over to the meeting list", () => {
    expect(
      notificationPath({
        kind: "meeting",
        roomId: "room-xyz",
        status: "ended",
        roomIsConversation: false,
      })
    ).toBe("/meetings");
  });

  it("prefers the chat over the call even for an active meeting, when the room is a chat", () => {
    // A call running in a conversation is reachable from that conversation,
    // and landing there keeps the history and the call button together.
    expect(
      notificationPath({
        kind: "meeting",
        roomId: "650000000000000000000002",
        status: "active",
        roomIsConversation: true,
      })
    ).toBe("/chats?id=650000000000000000000002");
  });

  it("opens the conversation a match already has", () => {
    expect(notificationPath({ kind: "connection", conversationId: "conv9" })).toBe(
      "/chats?id=conv9"
    );
  });

  it("sends a match with no conversation yet to the chat list", () => {
    expect(notificationPath({ kind: "connection", conversationId: null })).toBe("/chats");
  });

  it("has nowhere to send a notification whose subject is gone", () => {
    expect(notificationPath({ kind: "none" })).toBeNull();
  });
});
