/**
 * Checks that deleting an account really does take everything with it.
 *
 * Seeds a throwaway account with one row in every collection that references a
 * user, deletes it through the real HTTP route, and reports what survived. It
 * removes its own leftovers in a `finally`, and ends by comparing every count
 * against the baseline it took at the start, so a run that goes wrong says so
 * rather than quietly leaving rows behind.
 *
 * This exists because the interesting failures here are not ones a unit test
 * can see. `password` is `select: false` on the schema, and the first version
 * of the route read it without asking for it by name — so the password check
 * silently never ran and a session token alone could close an account. Nothing
 * short of a real request against a real row catches that.
 *
 *   npm run dev            # in another terminal; the route is live code
 *   npx tsx scripts/verify-account-deletion.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { issueSessionToken } from "../server/services/sessionToken";
import { hashPassword } from "../server/utils/passwordHash";

const BASE_URL = process.env.VERIFY_BASE_URL || "http://localhost:3000";

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
const oid = () => new mongoose.Types.ObjectId();
const seeded = { users: [], conversations: [], messages: [], others: [] };

const baseline = {};
const names = [
  "users",
  "conversations",
  "messages",
  "connections",
  "activitylogs",
  "notifications",
  "discoveries",
  "meetings",
  "invites",
  "otps",
  "revokedsessions",
];
for (const n of names) baseline[n] = await db.collection(n).countDocuments({});
console.log("baseline:", JSON.stringify(baseline));

try {
  const PW = "T3st-" + Math.random().toString(36).slice(2, 10);
  const A = {
    _id: oid(),
    firebaseUid: "zz-test-A-" + Date.now(),
    email: `zz-a-${Date.now()}@example.invalid`,
    name: "ZZ Test A",
    username: "zz_test_a",
    password: await hashPassword(PW),
    isEmailVerified: true,
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const B = {
    _id: oid(),
    firebaseUid: "zz-test-B-" + Date.now(),
    email: `zz-b-${Date.now()}@example.invalid`,
    name: "ZZ Test B",
    username: "zz_test_b",
    isEmailVerified: true,
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const GHOST = oid(); // a participant that does not exist at all
  await db.collection("users").insertMany([A, B]);
  seeded.users.push(A._id, B._id);

  // A chat B is still in, and one nobody is left in.
  const shared = {
    _id: oid(),
    participants: [A._id, B._id],
    isGroup: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const orphan = {
    _id: oid(),
    participants: [A._id, GHOST],
    isGroup: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection("conversations").insertMany([shared, orphan]);
  seeded.conversations.push(shared._id, orphan._id);

  const mk = (conv, sender, content) => ({
    _id: oid(),
    conversationId: conv._id,
    senderId: sender,
    content,
    messageType: "text",
    isRead: false,
    isPinned: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const msgs = [
    mk(shared, A._id, "from A"),
    mk(shared, B._id, "from B, must survive"),
    mk(orphan, A._id, "in the orphan"),
  ];
  await db.collection("messages").insertMany(msgs);
  seeded.messages.push(...msgs.map((m) => m._id));
  await db
    .collection("conversations")
    .updateOne({ _id: shared._id }, { $set: { lastMessage: msgs[0]._id } });

  const extras = [
    [
      "connections",
      {
        _id: oid(),
        participants: [A._id, B._id],
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    [
      "activitylogs",
      {
        _id: oid(),
        userId: A._id,
        action: "zz_test",
        timestamp: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    [
      "notifications",
      {
        _id: oid(),
        userId: A._id,
        type: "system",
        title: "zz",
        message: "zz",
        isRead: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    [
      "discoveries",
      {
        _id: oid(),
        viewerId: A._id,
        targetId: B._id,
        timestamp: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    [
      "invites",
      {
        _id: oid(),
        creatorId: A._id,
        code: "ZZTEST" + Date.now(),
        kind: "connection",
        maxUses: 1,
        uses: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    [
      "otps",
      {
        _id: oid(),
        email: A.email,
        code: "000000",
        purpose: "email_verification",
        expiresAt: new Date(Date.now() + 6e4),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    [
      "revokedsessions",
      {
        _id: oid(),
        jti: "zz" + Date.now(),
        userId: A._id,
        expiresAt: new Date(Date.now() + 6e4),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    [
      "meetings",
      {
        _id: oid(),
        title: "zz hosted by A",
        hostId: A._id,
        participants: [A._id, B._id],
        startTime: new Date(),
        status: "scheduled",
        roomId: "zz" + Date.now(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    [
      "meetings",
      {
        _id: oid(),
        title: "zz hosted by B",
        hostId: B._id,
        participants: [A._id, B._id],
        startTime: new Date(),
        status: "scheduled",
        roomId: "zz2" + Date.now(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  ];
  for (const [coll, doc] of extras) {
    await db.collection(coll).insertOne(doc);
    seeded.others.push([coll, doc._id]);
  }
  const meetingByB = extras[extras.length - 1][1];

  const token = await issueSessionToken({ sub: A._id.toString(), uid: A.firebaseUid, ver: 0 });
  const call = (body) =>
    fetch(`${BASE_URL}/api/auth/account`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  console.log("\n--- the guards ---");
  let r = await call({});
  console.log("no confirm, no password :", r.status, (await r.json()).error, "(expect 400)");
  r = await call({ confirm: "DELETE" });
  console.log("confirm, no password    :", r.status, (await r.json()).error, "(expect 400)");
  r = await call({ confirm: "DELETE", password: "not-the-password" });
  console.log("confirm, wrong password :", r.status, (await r.json()).error, "(expect 401)");
  r = await call({ confirm: "delete", password: PW });
  console.log("lowercase confirm       :", r.status, (await r.json()).error, "(expect 400)");
  const noAuth = await fetch(`${BASE_URL}/api/auth/account`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: "DELETE", password: PW }),
  });
  console.log("no token                :", noAuth.status, "(expect 401)");
  console.log(
    "account still there     :",
    !!(await db.collection("users").findOne({ _id: A._id })),
    "(expect true)"
  );

  console.log("\n--- the real thing ---");
  r = await call({ confirm: "DELETE", password: PW });
  const body = await r.json();
  console.log("status:", r.status);
  console.log("removed:", JSON.stringify(body.removed));

  console.log("\n--- what is left ---");
  const gone = async (coll, q) => (await db.collection(coll).countDocuments(q)) === 0;
  console.log("user row gone           :", await gone("users", { _id: A._id }));
  console.log("orphan conversation gone:", await gone("conversations", { _id: orphan._id }));
  console.log("its message gone        :", await gone("messages", { _id: msgs[2]._id }));
  console.log(
    "A's message in the chat :",
    (await gone("messages", { _id: msgs[0]._id })) ? "gone" : "STILL THERE"
  );
  console.log(
    "B's message in the chat :",
    (await gone("messages", { _id: msgs[1]._id })) ? "GONE (wrong)" : "kept"
  );
  const sharedAfter = await db.collection("conversations").findOne({ _id: shared._id });
  console.log(
    "shared chat kept        :",
    !!sharedAfter,
    "| participants:",
    sharedAfter?.participants.map(String).join(",") === B._id.toString() ? "just B" : "WRONG"
  );
  const lm = sharedAfter?.lastMessage;
  console.log(
    "its lastMessage resolves:",
    lm ? !!(await db.collection("messages").findOne({ _id: lm })) : "null"
  );
  console.log("connection gone         :", await gone("connections", { participants: A._id }));
  for (const c of ["activitylogs", "notifications", "discoveries", "invites", "revokedsessions"])
    console.log(
      `${c.padEnd(24)}:`,
      await gone(c, { $or: [{ userId: A._id }, { creatorId: A._id }, { viewerId: A._id }] })
    );
  console.log("otps for the address    :", await gone("otps", { email: A.email }));
  console.log("meeting A hosted gone   :", await gone("meetings", { hostId: A._id }));
  const kept = await db.collection("meetings").findOne({ _id: meetingByB._id });
  console.log(
    "meeting B hosted kept   :",
    !!kept,
    "| A pulled from it:",
    !kept?.participants.some((p) => p.equals(A._id))
  );
  console.log(
    "anything still naming A :",
    await gone("messages", { senderId: A._id }),
    await gone("conversations", { participants: A._id })
  );

  console.log("\n--- deleting it again ---");
  r = await call({ confirm: "DELETE", password: PW });
  console.log("status:", r.status, "(expect 401, the session is dead with the account)");
} finally {
  console.log("\n--- cleanup ---");
  for (const [coll, id] of seeded.others) await db.collection(coll).deleteOne({ _id: id });
  await db.collection("messages").deleteMany({ _id: { $in: seeded.messages } });
  await db.collection("conversations").deleteMany({ _id: { $in: seeded.conversations } });
  await db.collection("users").deleteMany({ _id: { $in: seeded.users } });
  await db.collection("connections").deleteMany({ participants: { $in: seeded.users } });
  const after = {};
  for (const n of names) after[n] = await db.collection(n).countDocuments({});
  const drift = names.filter((n) => after[n] !== baseline[n]);
  console.log("counts after cleanup:", JSON.stringify(after));
  console.log(drift.length ? `DRIFT in ${drift.join(", ")}` : "back to baseline exactly");
  await mongoose.disconnect();
}
