import { logger } from "../utils/logger";
import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { apiRateLimiter } from "../middleware/rateLimiter";
import { mongoService } from "../services/mongodb";

const router = Router();

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

    const { firebaseToken, ...meetingData } = req.body;

    // Generate a random room ID if not provided
    const roomId = meetingData.roomId || Math.random().toString(36).substring(7);

    // Ensure participants is an array
    const participants = meetingData.participants || [];

    const meeting = await mongoService.createMeeting({
      ...meetingData,
      roomId,
      participants,
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
