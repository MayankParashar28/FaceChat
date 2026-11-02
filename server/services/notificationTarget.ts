/**
 * Where a notification takes you when you click it.
 *
 * Every notification already carries a `relatedId` — the thing it is about —
 * but it carries no hint of which collection that id belongs to, and a
 * different one is used for each kind: a Meeting for a missed call or a
 * reminder, a Conversation for a GhostLink, a Connection for a match. So the
 * page could not turn one into a destination, and settled for sending every
 * clickable notification to the chat list and leaving the rest inert. Being
 * told you missed a call from someone and then having to find them yourself is
 * most of the work the notification was supposed to save.
 *
 * The lookups belong to the route, which has the caller's identity to scope
 * them by. What is left here is the decision: given what the related id turned
 * out to be, which screen answers it.
 */

/** What a notification's `relatedId` resolved to, once it has been looked up. */
export type RelatedThing =
  | { kind: "conversation"; id: string }
  | {
      kind: "meeting";
      roomId: string;
      status: "scheduled" | "active" | "ended";
      /**
       * Whether `roomId` names a conversation rather than a standalone room.
       * A call placed from a chat uses the conversation's own id as its room,
       * which is what makes a missed call answerable in that chat.
       */
      roomIsConversation: boolean;
    }
  | { kind: "connection"; conversationId: string | null }
  /** The related thing is gone, or there never was one. */
  | { kind: "none" };

/**
 * The in-app path for a resolved notification, or null when there is nowhere
 * honest to send someone.
 *
 * Null is a real answer, not a failure: a GhostLink chat that has since
 * vanished, or a notification whose subject was deleted, has no destination,
 * and the page says so rather than navigating somewhere that looks like an
 * answer and is not.
 */
export function notificationPath(thing: RelatedThing): string | null {
  switch (thing.kind) {
    case "conversation":
      return `/chats?id=${thing.id}`;

    case "meeting":
      // A missed call from a chat belongs back in that chat — the message
      // history is there and so is the way to call back.
      if (thing.roomIsConversation) return `/chats?id=${thing.roomId}`;
      // A call that is happening now can be joined. One that has not started,
      // or is already over, cannot, so it goes to the meeting list where it
      // can be seen in context.
      return thing.status === "active" ? `/call/${thing.roomId}` : "/meetings";

    case "connection":
      // A match with a conversation already open goes straight to it; one
      // without goes to the list, where starting it is the obvious next move.
      return thing.conversationId ? `/chats?id=${thing.conversationId}` : "/chats";

    case "none":
      return null;
  }
}
