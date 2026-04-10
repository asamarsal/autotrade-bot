// ============================================================
// src/utils.js — helper functions umum
// ============================================================

const fs = require("fs");
const path = require("path");

// --- LOGGER ---
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const levels = { debug: 0, info: 1, error: 2 };

function log(level, msg, data = null) {
  if (levels[level] < levels[LOG_LEVEL]) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  if (data) {
    console.log(`${prefix} ${msg}`, data);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

const logger = {
  debug: (msg, data) => log("debug", msg, data),
  info: (msg, data) => log("info", msg, data),
  error: (msg, data) => log("error", msg, data),
};

// --- FILE HELPERS ---
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function saveJSON(filePath, data) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  logger.debug(`Saved JSON → ${filePath}`);
}

function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File tidak ditemukan: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function appendLine(filePath, line) {
  ensureDir(filePath);
  fs.appendFileSync(filePath, line + "\n");
}

// --- MATH HELPERS ---
function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  const m = mean(arr);
  const variance = arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function round(val, decimals = 4) {
  return Math.round(val * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// --- ARRAY HELPERS ---
function last(arr, n = 1) {
  return n === 1 ? arr[arr.length - 1] : arr.slice(-n);
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

// --- TIMESTAMP ---
function tsToDate(ts) {
  return new Date(ts).toISOString();
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

module.exports = {
  logger,
  saveJSON,
  loadJSON,
  appendLine,
  ensureDir,
  mean,
  stddev,
  clamp,
  round,
  last,
  sum,
  tsToDate,
  formatDuration,
};
