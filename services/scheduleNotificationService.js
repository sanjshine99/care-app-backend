// backend/services/scheduleNotificationService.js
// Automatic notifications: monthly reminders + daily schedule expiry checks

const cron = require("node-cron");
const Notification = require("../models/Notification");
const AdminUser = require("../models/AdminUser");
const Appointment = require("../models/Appointment");
const notificationService = require("./notificationService");
const moment = require("moment");

class ScheduleNotificationService {
  constructor() {
    this.monthlyJob = null;
    this.expiryJob = null;
  }

  /**
   * Start the schedulers
   * - Monthly reminder: 25th of each month at 9:00 AM
   * - Daily expiry check: every day at 9:00 AM
   */
  start() {
    // Monthly reminder on 25th at 9:00 AM
    this.monthlyJob = cron.schedule("0 9 25 * *", async () => {
      console.log("[Schedule Notification] Running monthly reminder check...");
      await this.sendMonthlyReminder();
    });

    // Daily expiry check at 9:00 AM
    this.expiryJob = cron.schedule("0 9 * * *", async () => {
      console.log("[Schedule Notification] Running daily expiry check...");
      await this.checkScheduleExpiry();
    });

    console.log(
      " Schedule notification service started (monthly on 25th + daily expiry check at 9:00 AM)",
    );

    // Run checks on startup if applicable
    const today = moment();
    if (today.date() === 25) {
      console.log(
        "[Schedule Notification] Today is the 25th - checking reminders...",
      );
      this.sendMonthlyReminder();
    }

    // Always check expiry on startup
    this.checkScheduleExpiry();
  }

  /**
   * Stop the schedulers
   */
  stop() {
    if (this.monthlyJob) {
      this.monthlyJob.stop();
    }
    if (this.expiryJob) {
      this.expiryJob.stop();
    }
    console.log(" Schedule notification service stopped");
  }

  /**
   * Send monthly reminder to admin
   */
  async sendMonthlyReminder() {
    try {
      const nextMonth = moment().add(1, "month");
      const nextMonthName = nextMonth.format("MMMM YYYY");
      const nextMonthStart = nextMonth.clone().startOf("month").toDate();
      const nextMonthEnd = nextMonth.clone().endOf("month").toDate();

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
          `[Schedule Notification] No schedule found for ${nextMonthName} - sending reminder`,
        );

        const admins = await AdminUser.find({ role: "admin" });

        for (const admin of admins) {
          await Notification.create({
            adminUser: admin._id,
            type: "warning",
            priority: "high",
            title: `Generate Schedule for ${nextMonthName}`,
            message: `It's time to generate the schedule for ${nextMonthName}. Click to generate appointments for next month.`,
            metadata: {
              action: "schedule_monthly_reminder",
              resourceType: "schedule",
              details: {
                month: nextMonth.format("YYYY-MM"),
                monthName: nextMonthName,
                existingAppointments,
              },
            },
            actionRequired: true,
            actionUrl: "/schedule/generate",
            actionLabel: "Generate Schedule",
          });
        }

        console.log(
          ` Sent schedule reminder for ${nextMonthName} to ${admins.length} admin(s)`,
        );
      } else {
        console.log(
          `[Schedule Notification] Schedule for ${nextMonthName} already exists (${existingAppointments} appointments) - no reminder sent`,
        );
      }
    } catch (error) {
      console.error(
        "[Schedule Notification] Error sending monthly reminder:",
        error,
      );
    }
  }

  /**
   * Check if the current schedule is expiring soon (within 7 days)
   * Sends a warning notification to all admins if so, with 3-day dedup
   */
  async checkScheduleExpiry() {
    try {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      // Find the furthest future scheduled appointment
      const lastAppointment = await Appointment.findOne({
        status: "scheduled",
        date: { $gte: today },
      })
        .sort({ date: -1 })
        .select("date")
        .lean();

      if (!lastAppointment) {
        console.log("[Schedule Notification] No future scheduled appointments found - skipping expiry check");
        return;
      }

      const daysRemaining = moment.utc(lastAppointment.date).diff(moment.utc(today), "days");

      if (daysRemaining > 7) {
        console.log(
          `[Schedule Notification] Schedule expires in ${daysRemaining} days - no warning needed`,
        );
        return;
      }

      // Check for duplicate notification in last 3 days to avoid spam
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const recentNotification = await Notification.findOne({
        "metadata.action": "schedule_expiry_warning",
        createdAt: { $gte: threeDaysAgo },
      }).lean();

      if (recentNotification) {
        console.log("[Schedule Notification] Expiry warning already sent recently - skipping");
        return;
      }

      // Send expiry warning to all admins
      const admins = await AdminUser.find({ role: "admin" });

      for (const admin of admins) {
        await notificationService.notifyScheduleExpiring(
          admin._id,
          lastAppointment.date,
          daysRemaining,
        );
      }

      console.log(
        `[Schedule Notification] Sent expiry warning (${daysRemaining} days remaining) to ${admins.length} admin(s)`,
      );
    } catch (error) {
      console.error(
        "[Schedule Notification] Error checking schedule expiry:",
        error,
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
   * Manually trigger expiry check (for testing)
   */
  async triggerExpiryCheck() {
    console.log("[Schedule Notification] Manual expiry check requested");
    await this.checkScheduleExpiry();
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
        error,
      );
      throw error;
    }
  }
}

// Create singleton instance
const scheduleNotificationService = new ScheduleNotificationService();

module.exports = scheduleNotificationService;
