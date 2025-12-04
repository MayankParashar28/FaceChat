import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { apiRateLimiter } from "../middleware/rateLimiter";
import { mongoService } from "../services/mongodb";

const router = Router();

// Create a new meeting
router.post("/", apiRateLimiter, authenticate, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const dbUser = req.user.dbUser || await mongoService.getUserByFirebaseUid(req.user.uid);
        if (!dbUser) {
            return res.status(404).json({ error: "User not found in database" });
        }

        const { firebaseToken, ...meetingData } = req.body;

        const meeting = await mongoService.createMeeting({
            ...meetingData,
            hostId: dbUser._id.toString() // Use MongoDB ObjectId, not Firebase UID
        });

        res.json(meeting);
    } catch (error) {
        console.error("Error creating meeting:", error);
        res.status(500).json({ error: "Failed to create meeting" });
    }
});

// Get current user's meetings
router.get("/", authenticate, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const dbUser = req.user.dbUser || await mongoService.getUserByFirebaseUid(req.user.uid);
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
            meetings = meetings.filter(m => m.status === status);
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
        console.error("Error fetching user meetings:", error);
        res.status(500).json({ error: "Failed to fetch meetings" });
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
        console.error("Error fetching meeting:", error);
        res.status(500).json({ error: "Failed to fetch meeting" });
    }
});

// Get meeting messages
router.get("/:id/messages", authenticate, async (req, res) => {
    try {
        const messages = await mongoService.getMeetingMessages(req.params.id);
        res.json(messages);
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ error: "Failed to fetch messages" });
    }
});

export default router;
