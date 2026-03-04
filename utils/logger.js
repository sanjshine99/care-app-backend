const winston = require("winston");
const path = require("path");

const isProd = process.env.NODE_ENV === "production";

// Production: JSON format for log aggregators (CloudWatch, Datadog, etc.)
// Development: colorized simple format for readability
const formats = isProd
  ? winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    )
  : winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: "HH:mm:ss" }),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const extras = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
        return `${timestamp} ${level}: ${message}${extras}`;
      }),
    );

const transports = [new winston.transports.Console()];

// In production, also write errors and combined log to files
if (isProd) {
  try {
    const fs = require("fs");
    const logDir = path.join(__dirname, "../logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, "error.log"),
        level: "error",
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
      }),
      new winston.transports.File({
        filename: path.join(logDir, "combined.log"),
        maxsize: 10 * 1024 * 1024,
        maxFiles: 10,
      }),
    );
  } catch (_) {
    // Non-fatal: log directory creation failure falls back to console-only
  }
}

const logger = winston.createLogger({
  level: isProd ? "info" : "debug",
  format: formats,
  transports,
});

module.exports = logger;
