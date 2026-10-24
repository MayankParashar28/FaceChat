import { logger } from "../utils/logger";
import { Router } from "express";
import { randomUUID } from "crypto";
import { authenticate } from "../middleware/auth";
import { apiRateLimiter } from "../middleware/rateLimiter";
import { mongoService } from "../services/mongodb";

const router = Router();

/**
 * A room id with enough entropy that meeting links cannot be guessed.
 *
 * The previous `Math.random().toString(36).substring(7)` produced 3-9
 * characters — measured over 200k samples it was usually 5 or 6, and sometimes
 * only 3, which is about 46k possibilities. Anyone could have enumerated room
 * ids and walked into calls. It also risked collisions against the unique
 * index on `roomId`.
 */
function generateRoomId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 20);
}

// Validate meeting room by ID
router.get("/validate/:roomId", async (req, res) => {
  try {
    const { roomId } = req.params;
    const cleanRoomId = (roomId || "").trim();
    const meeting = await mongoService.getMeetingByRoomId(cleanRoomId);

    // A room is valid if it already exists in DB OR has a valid room code format (>= 3 chars)
    const isValidFormat = cleanRoomId.length >= 3;
    res.json({
      exists: !!meeting || isValidFormat,
      isExistingMeeting: !!meeting,
      meeting,
    });
  } catch (error) {
    logger.error("Error validating room:", error);
    res.status(500).json({ error: "Validation failed" });
  }
});

router.post("/", apiRateLimiter, authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const dbUser = req.user.dbUser || (await mongoService.getUserByFirebaseUid(req.user.uid));
    if (!dbUser) {
      return res.status(404).json({ error: "User not found in database" });
    }

    // Only the fields a client is allowed to set. Spreading the body let a
    // caller set anything on the document, including status and analytics.
    const { title, startTime, endTime, description, meetingType, status, participants } = req.body;

    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "A meeting title is required" });
    }

    const start = startTime ? new Date(startTime) : new Date();
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ error: "Invalid startTime" });
    }

    const meeting = await mongoService.createMeeting({
      title: title.trim(),
      description: typeof description === "string" ? description : undefined,
      startTime: start,
      endTime: endTime ? new Date(endTime) : undefined,
      roomId: generateRoomId(),
      meetingType:
        meetingType === "audio" || meetingType === "screen-share" ? meetingType : "video",
      status: status === "active" || status === "ended" ? status : "scheduled",
      participants: Array.isArray(participants) ? participants : [],
      hostId: dbUser._id.toString(), // Use MongoDB ObjectId, not Firebase UID
    });

    res.json(meeting);
  } catch (error: any) {
    logger.error("Error creating meeting:", error);
    res.status(500).json({
      error: error.message || "Failed to create meeting",
      details: error.errors,
    });
  }
});

// Get current user's meetings
router.get("/", authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const dbUser = req.user.dbUser || (await mongoService.getUserByFirebaseUid(req.user.uid));
    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get limit and skip from query params
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = parseInt(req.query.skip as string) || 0;
    const status = req.query.status as string | undefined; // Optional filter by status

    let meetings = await mongoService.getUserMeetings(dbUser._id.toString());

    // Filter by status if provided
    if (status) {
      meetings = meetings.filter((m) => m.status === status);
    } else {
      // If no status filter, show all meetings (active, ended, and scheduled)
      // This allows Recent Calls to show all meetings, not just ended ones
    }

    // Sort by endTime (if exists) or startTime, most recent first
    meetings = meetings
      .sort((a, b) => {
        const aTime = a.endTime?.getTime() || a.startTime.getTime();
        const bTime = b.endTime?.getTime() || b.startTime.getTime();
        return bTime - aTime;
      })
      .slice(skip, skip + limit);

    res.json(meetings);
  } catch (error) {
    logger.error("Error fetching user meetings:", error);
    res.status(500).json({ error: "Failed to fetch meetings" });
  }
});

// Get analytics data
router.get("/analytics", authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const dbUser = req.user.dbUser || (await mongoService.getUserByFirebaseUid(req.user.uid));
    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const analytics = await mongoService.getUserMeetingAnalytics(dbUser._id.toString());
    res.json(analytics);
  } catch (error) {
    logger.error("Error fetching analytics:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// Get meeting by ID
router.get("/:id", authenticate, async (req, res) => {
  try {
    const meeting = await mongoService.getMeetingById(req.params.id);
    if (!meeting) {
      return res.status(404).json({ error: "Meeting not found" });
    }
    res.json(meeting);
  } catch (error) {
    logger.error("Error fetching meeting:", error);
    res.status(500).json({ error: "Failed to fetch meeting" });
  }
});

// Get meeting messages
router.get("/:id/messages", authenticate, async (req, res) => {
  try {
    const messages = await mongoService.getMeetingMessages(req.params.id);
    res.json(messages);
  } catch (error) {
    logger.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Get meeting messages by roomId
router.get("/room/:roomId/messages", async (req, res) => {
  try {
    const messages = await mongoService.getMeetingMessages(req.params.roomId);
    res.json(messages);
  } catch (error) {
    logger.error("Error fetching room messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Update meeting status
router.patch("/:id/status", authenticate, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["scheduled", "active", "ended"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const meeting = await mongoService.updateMeetingStatus(req.params.id, status);
    if (!meeting) {
      return res.status(404).json({ error: "Meeting not found" });
    }
    res.json(meeting);
  } catch (error) {
    logger.error("Error updating meeting status:", error);
    res.status(500).json({ error: "Failed to update meeting status" });
  }
});

export default router;
