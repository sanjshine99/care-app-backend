const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");
const http = require("http");
require("dotenv").config();

const connectDB = require("./config/database");
const errorHandler = require("./middleware/errorHandler");

// Import routes
const authRoutes = require("./routes/auth.routes");
const careGiverRoutes = require("./routes/caregiver.routes");
const careReceiverRoutes = require("./routes/carereceiver.routes");
const scheduleRoutes = require("./routes/schedule.routes");
const notificationRoutes = require("./routes/notification.routes");
const settingsRoutes = require("./routes/settings.routes");
const mapRoutes = require("./routes/map.routes");

const app = express();
const server = http.createServer(app);

// ========================================
// CORS CONFIGURATION - PRODUCTION READY
// ========================================
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
  // Add your Render frontend URL here when deployed:
  "https://care-app-frontend.onrender.com",
];

// Add CORS_ORIGIN from environment if it exists
if (process.env.CORS_ORIGIN) {
  allowedOrigins.push(process.env.CORS_ORIGIN);
}

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`⚠️  Blocked by CORS: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
};

// Socket.io setup
const io = new Server(server, {
  cors: corsOptions,
});

// Make io accessible to routes
app.set("io", io);

// Connect to MongoDB
connectDB();

// ========================================
// MIDDLEWARE
// ========================================
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Request logging
if (process.env.NODE_ENV === "development") {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
} else {
  // Production logging (less verbose)
  app.use((req, res, next) => {
    if (req.path !== "/health") {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    }
    next();
  });
}

// ========================================
// HEALTH CHECK ENDPOINT (REQUIRED FOR RENDER)
// ========================================
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    mongodb:
      require("mongoose").connection.readyState === 1
        ? "connected"
        : "disconnected",
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Care Scheduling API",
    version: "1.0.0",
    status: "running",
    endpoints: {
      health: "/health",
      api: "/api",
      docs: "/api/docs (coming soon)",
    },
  });
});

// ========================================
// API ROUTES
// ========================================
app.use("/api/auth", authRoutes);
app.use("/api/caregivers", careGiverRoutes);
app.use("/api/carereceivers", careReceiverRoutes);
app.use("/api/schedule", scheduleRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/map", mapRoutes);
app.use("/api/diagnostic", require("./routes/diagnostic.routes"));

// ========================================
// ERROR HANDLING
// ========================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: "Route not found",
      code: "ROUTE_NOT_FOUND",
      path: req.path,
    },
  });
});

// Error handler (must be last)
app.use(errorHandler);

// ========================================
// SOCKET.IO
// ========================================
io.on("connection", (socket) => {
  console.log("✓ Client connected:", socket.id);

  // Join user-specific room for targeted notifications
  socket.on("join", (userId) => {
    socket.join(userId);
    console.log(`✓ User ${userId} joined their room`);
  });

  socket.on("disconnect", () => {
    console.log("✗ Client disconnected:", socket.id);
  });
});

// ========================================
// START SERVER
// ========================================
const PORT = process.env.PORT || 5000;
const HOST = process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost";

server.listen(PORT, HOST, () => {
  console.log("\n" + "=".repeat(50));
  console.log("🚀 SERVER STARTED");
  console.log("=".repeat(50));
  console.log(`📍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🌐 Port: ${PORT}`);
  console.log(
    `🔗 API: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/api`
  );
  console.log(
    `💚 Health: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/health`
  );
  console.log(
    `🗄️  MongoDB: ${require("mongoose").connection.readyState === 1 ? "✓ Connected" : "⏳ Connecting..."}`
  );
  console.log("=".repeat(50) + "\n");
});

// ========================================
// GRACEFUL SHUTDOWN
// ========================================
const gracefulShutdown = (signal) => {
  console.log(`\n${signal} signal received: closing HTTP server`);

  server.close(() => {
    console.log("HTTP server closed");

    // Close database connections
    require("mongoose").connection.close(false, () => {
      console.log("MongoDB connection closed");
      process.exit(0);
    });
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down"
    );
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
  gracefulShutdown("UNHANDLED_REJECTION");
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

module.exports = app;
