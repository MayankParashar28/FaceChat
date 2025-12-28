import { Meeting, Notification, User } from "../models";

// Check every minute
const CHECK_INTERVAL = 60 * 1000;
const REMINDER_WINDOW_MINUTES = 15;

export function startCronJobs() {
    console.log("⏰ Starting cron jobs...");

    setInterval(async () => {
        try {
            const now = new Date();
            const reminderTime = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60 * 1000);

            // Find scheduled meetings starting within the next 15-16 minutes
            // We widen the window slightly to catch anything in the "15 min before" slot
            // To avoid duplicate notifications, we should check if a notification already exists
            // or use a flag on the meeting. For simplicity here, we'll check overlap 
            // but a cleaner way is usually a "reminded" flag on the meeting.
            // Let's assume we want to catch meetings starting between now+14 and now+15 to essentially only fire once.

            const startWindow = new Date(now.getTime() + (REMINDER_WINDOW_MINUTES - 1) * 60 * 1000);
            const endWindow = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60 * 1000);

            const upcomingMeetings = await Meeting.find({
                status: 'scheduled',
                startTime: {
                    $gte: startWindow,
                    $lte: endWindow
                }
            });

            for (const meeting of upcomingMeetings) {
                console.log(`🔔 Found meeting starting soon: ${meeting.title}`);

                // Send to all participants
                for (const participantId of meeting.participants) {
                    // Check if already notified (deduplication safeguard)
                    const existingNotif = await Notification.findOne({
                        userId: participantId,
                        type: 'system',
                        relatedId: meeting._id,
                        title: { $regex: /Starting Soon/ }
                    });

                    if (!existingNotif) {
                        await Notification.create({
                            userId: participantId,
                            type: 'system',
                            title: "Meeting Starting Soon ⏳",
                            message: `"${meeting.title}" starts in about 15 minutes.`,
                            relatedId: meeting._id
                        });
                    }
                }
            }
        } catch (error) {
            console.error("Error in cron job:", error);
        }
    }, CHECK_INTERVAL);
}
