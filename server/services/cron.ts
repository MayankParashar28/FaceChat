import { logger } from "../utils/logger";
import { Meeting, Notification } from "../models";
import http from "http";
import https from "https";

// Check every minute
const CHECK_INTERVAL = 60 * 1000;
const PING_INTERVAL = 4 * 60 * 1000; // Self-ping every 4 minutes to keep server awake
const REMINDER_WINDOW_MINUTES = 15;

function selfPing() {
  try {
    const urlsToPing: string[] = [];
    if (process.env.APP_URL)
      urlsToPing.push(
        process.env.APP_URL.endsWith("/")
          ? `${process.env.APP_URL}api/health`
          : `${process.env.APP_URL}/api/health`
      );
    if (process.env.RENDER_EXTERNAL_URL)
      urlsToPing.push(`${process.env.RENDER_EXTERNAL_URL}/api/health`);
    if (process.env.RAILWAY_STATIC_URL)
      urlsToPing.push(`https://${process.env.RAILWAY_STATIC_URL}/api/health`);

    const port = process.env.PORT || 3000;
    urlsToPing.push(`http://127.0.0.1:${port}/api/health`);

    const targetUrl = urlsToPing[0];
    const isHttps = targetUrl.startsWith("https");
    const client = isHttps ? https : http;

    client
      .get(targetUrl, (res) => {
        logger.info(`⚡ Keep-alive ping sent to ${targetUrl} (Status: ${res.statusCode})`);
      })
      .on("error", () => {
        // Quietly ignore connection errors on self ping
      });
  } catch (err) {}
}

export function startCronJobs() {
  logger.info("⏰ Starting cron jobs & Keep-Alive ping worker...");

  // Immediate self-ping on launch
  selfPing();

  // Run keep-alive self ping every 4 minutes
  setInterval(() => {
    selfPing();
  }, PING_INTERVAL);

  setInterval(async () => {
    try {
      const now = new Date();

      const startWindow = new Date(now.getTime() + (REMINDER_WINDOW_MINUTES - 1) * 60 * 1000);
      const endWindow = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60 * 1000);

      const upcomingMeetings = await Meeting.find({
        status: "scheduled",
        startTime: {
          $gte: startWindow,
          $lte: endWindow,
        },
      }).lean();

      for (const meeting of upcomingMeetings) {
        logger.info(`🔔 Found meeting starting soon: ${meeting.title}`);

        for (const participantId of meeting.participants) {
          const existingNotif = await Notification.findOne({
            userId: participantId,
            type: "system",
            relatedId: meeting._id,
            title: { $regex: /Starting Soon/ },
          }).lean();

          if (!existingNotif) {
            await Notification.create({
              userId: participantId,
              type: "system",
              title: "Meeting Starting Soon ⏳",
              message: `"${meeting.title}" starts in about 15 minutes.`,
              relatedId: meeting._id,
            });
          }
        }
      }
    } catch (error) {
      logger.error("Error in cron job:", error);
    }
  }, CHECK_INTERVAL);
}
