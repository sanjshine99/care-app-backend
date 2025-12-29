// backend/services/scheduleNotificationService.js
// Automatic monthly notifications to remind admin to generate schedule

const cron = require("node-cron");
const Notification = require("../models/Notification");
const AdminUser = require("../models/AdminUser");
const Appointment = require("../models/Appointment");
const moment = require("moment");

class ScheduleNotificationService {
  constructor() {
    this.cronJob = null;
  }

  /**
   * Start the scheduler
   * Runs on the 25th of each month at 9:00 AM
   * Reminds admin to generate next month's schedule
   */
  start() {
    // Run on 25th of each month at 9:00 AM
    // Format: minute hour day month day-of-week
    this.cronJob = cron.schedule("0 9 25 * *", async () => {
      console.log("[Schedule Notification] Running monthly reminder check...");
      await this.sendMonthlyReminder();
    });

    console.log(
      "✅ Schedule notification service started (runs on 25th at 9:00 AM)"
    );

    // Also run immediately on startup if it's the 25th
    const today = moment();
    if (today.date() === 25) {
      console.log(
        "[Schedule Notification] Today is the 25th - checking reminders..."
      );
      this.sendMonthlyReminder();
    }
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      console.log("❌ Schedule notification service stopped");
    }
  }

  /**
   * Send monthly reminder to admin
   */
  async sendMonthlyReminder() {
    try {
      const nextMonth = moment().add(1, "month");
      const nextMonthName = nextMonth.format("MMMM YYYY");
      const nextMonthStart = nextMonth.startOf("month").toDate();
      const nextMonthEnd = nextMonth.endOf("month").toDate();

      // Check if schedule already exists for next month
      const existingAppointments = await Appointment.countDocuments({
        date: {
          $gte: nextMonthStart,
          $lte: nextMonthEnd,
        },
      });

      // Only send notification if few or no appointments exist
      if (existingAppointments < 10) {
        console.log(
          `[Schedule Notification] No schedule found for ${nextMonthName} - sending reminder`
        );

        // Get all admin users
        const admins = await AdminUser.find({ role: "admin" });

        // Create notification for each admin
        for (const admin of admins) {
          await Notification.create({
            user: admin._id,
            type: "schedule_reminder",
            title: `Generate Schedule for ${nextMonthName}`,
            message: `It's time to generate the schedule for ${nextMonthName}. Click to generate appointments for next month.`,
            link: "/schedule/generate",
            priority: "high",
            metadata: {
              month: nextMonth.format("YYYY-MM"),
              monthName: nextMonthName,
              existingAppointments: existingAppointments,
            },
          });
        }

        console.log(
          `✅ Sent schedule reminder for ${nextMonthName} to ${admins.length} admin(s)`
        );
      } else {
        console.log(
          `[Schedule Notification] Schedule for ${nextMonthName} already exists (${existingAppointments} appointments) - no reminder sent`
        );
      }
    } catch (error) {
      console.error(
        "[Schedule Notification] Error sending monthly reminder:",
        error
      );
    }
  }

  /**
   * Manually trigger reminder (for testing)
   */
  async triggerManual() {
    console.log("[Schedule Notification] Manual trigger requested");
    await this.sendMonthlyReminder();
  }

  /**
   * Check schedule status for a specific month
   */
  async getScheduleStatus(year, month) {
    try {
      const startDate = moment(`${year}-${month}-01`).startOf("month").toDate();
      const endDate = moment(`${year}-${month}-01`).endOf("month").toDate();

      const appointmentCount = await Appointment.countDocuments({
        date: {
          $gte: startDate,
          $lte: endDate,
        },
      });

      const scheduledCount = await Appointment.countDocuments({
        date: {
          $gte: startDate,
          $lte: endDate,
        },
        status: "scheduled",
      });

      return {
        month: moment(`${year}-${month}-01`).format("MMMM YYYY"),
        total: appointmentCount,
        scheduled: scheduledCount,
        hasSchedule: appointmentCount > 0,
      };
    } catch (error) {
      console.error(
        "[Schedule Notification] Error getting schedule status:",
        error
      );
      throw error;
    }
  }
}

// Create singleton instance
const scheduleNotificationService = new ScheduleNotificationService();

module.exports = scheduleNotificationService;
