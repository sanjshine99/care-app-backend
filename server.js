const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");
const http = require("http");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
require("dotenv").config();
const logger = require("./utils/logger");
const socketService = require("./services/socketService");

// ========================================
// STARTUP ENV VALIDATION
// ========================================
const REQUIRED_ENV_VARS = ["MONGODB_URI", "JWT_SECRET"];
const missingVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missingVars.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missingVars.join(", ")}`);
  process.exit(1);
}

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
const usersRoutes = require("./routes/users.routes");

const app = express();
const server = http.createServer(app);

// ========================================
// CORS CONFIGURATION - PRODUCTION READY
// ========================================
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:4000",
  "http://localhost:5173",
  "http://localhost:5174",
  // Add your Render frontend URL here when deployed:
  "https://care-platform-frontend.onrender.com",
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
      console.warn(`  Blocked by CORS: ${origin}`);
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

// ========================================
// SOCKET.IO JWT AUTHENTICATION MIDDLEWARE
// ========================================
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error("Unauthorized: No token provided"));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch {
    next(new Error("Unauthorized: Invalid token"));
  }
});

// Make io accessible to routes
app.set("io", io);

// Expose io to services that run outside the request cycle (e.g. background schedule)
socketService.init(io);

// Connect to MongoDB
connectDB();

// ========================================
// RATE LIMITING
// ========================================
const scheduleLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3,
  message: {
    success: false,
    error: {
      message: "Schedule generation rate limit exceeded. Please wait before retrying.",
      code: "RATE_LIMIT_EXCEEDED",
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  message: {
    success: false,
    error: { message: "Too many requests, please slow down.", code: "RATE_LIMIT_EXCEEDED" },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ========================================
// MIDDLEWARE
// ========================================
app.use(compression()); // Gzip/deflate responses — reduces payload size 60-80%
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Request logging
app.use((req, res, next) => {
  if (req.path !== "/health") {
    logger.http(`${req.method} ${req.path}`);
  }
  next();
});

// ========================================
// HEALTH CHECK ENDPOINT (REQUIRED FOR RENDER)
// ========================================
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
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
// Apply general rate limit to all API routes
app.use("/api/", generalApiLimiter);

// Specific stricter limits applied inline with route registration
app.use("/api/auth", authRoutes);
app.use("/api/caregivers", careGiverRoutes);
app.use("/api/carereceivers", careReceiverRoutes);
// Apply strict limiter to schedule generation before the route handler
app.use("/api/schedule/generate", scheduleLimiter);
app.use("/api/schedule", scheduleRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/map", mapRoutes);
app.use("/api/users", usersRoutes);
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
  logger.info("Socket connected", { socketId: socket.id, userId: socket.userId });

  // Automatically join the authenticated user's own room.
  // socket.userId is set by the JWT auth middleware above — clients cannot
  // join arbitrary rooms or receive other users' notifications.
  socket.join(socket.userId);

  socket.on("disconnect", () => {
    logger.info("Socket disconnected", { socketId: socket.id });
  });
});

// ========================================
// START SERVER
// ========================================
const PORT = process.env.PORT || 5000;
const HOST = process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost";

server.listen(PORT, HOST, () => {
  logger.info("Server started", {
    env: process.env.NODE_ENV || "development",
    port: PORT,
    api: `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/api`,
  });
  const scheduleJobWorker = require("./workers/scheduleJobWorker");
  scheduleJobWorker.start();
  const scheduleNotificationService = require("./services/scheduleNotificationService");
  scheduleNotificationService.start();
});

// ========================================
// GRACEFUL SHUTDOWN
// ========================================
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received — shutting down`);
  try {
    const scheduleJobWorker = require("./workers/scheduleJobWorker");
    scheduleJobWorker.stop();
  } catch (_) {}

  server.close(() => {
    logger.info("HTTP server closed");
    require("mongoose")
      .connection.close(false)
      .then(() => {
        logger.info("MongoDB connection closed");
        process.exit(0);
      })
      .catch((err) => {
        logger.error("MongoDB close error", { error: err?.message });
        process.exit(1);
      });
  });

  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (err) => {
  logger.error("Unhandled Rejection", { error: err?.message, stack: err?.stack });
  gracefulShutdown("UNHANDLED_REJECTION");
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception", { error: err?.message, stack: err?.stack });
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

module.exports = app;
