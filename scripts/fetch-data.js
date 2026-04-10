// ============================================================
// scripts/fetch-data.js — fetch candle historis dari Binance
// Jalankan: node scripts/fetch-data.js
// ============================================================

require("dotenv").config({ path: "./config/.env" });

const https = require("https");
const { saveJSON, logger, ensureDir } = require("../src/utils");
const C = require("../config/constants");

const BINANCE_BASE = "https://api.binance.com";

/**
 * Fetch klines dari Binance REST API
 * Max 1000 candle per request → loop untuk ambil lebih banyak
 */
function fetchKlines(symbol, interval, limit, startTime = null) {
  return new Promise((resolve, reject) => {
    let url = `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (startTime) url += `&startTime=${startTime}`;

    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

/**
 * Parse raw Binance kline ke format standar
 * Binance format: [openTime, open, high, low, close, volume, closeTime, ...]
 */
function parseKlines(raw) {
  return raw.map((k) => ({
    timestamp: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  }));
}

/**
 * Fetch candle historis dalam jumlah besar
 * @param {number} totalCandles - total candle yang diinginkan (default 5000)
 */
async function fetchHistorical(totalCandles = 5000) {
  const symbol = C.BINANCE_SYMBOL;
  const interval = C.BINANCE_INTERVAL;
  const batchSize = 1000; // max per request Binance

  logger.info(`Fetching ${totalCandles} candles ${symbol} ${interval} dari Binance...`);

  let allCandles = [];
  let startTime = null;

  // Hitung berapa batch yang perlu
  const batches = Math.ceil(totalCandles / batchSize);

  // Mulai dari waktu terjauh
  const now = Date.now();
  const msPerCandle = 60 * 1000; // 1m = 60000ms
  startTime = now - totalCandles * msPerCandle;

  for (let b = 0; b < batches; b++) {
    const limit = Math.min(batchSize, totalCandles - allCandles.length);
    logger.info(`Batch ${b + 1}/${batches}: fetch ${limit} candle dari ${new Date(startTime).toISOString()}`);

    try {
      const raw = await fetchKlines(symbol, interval, limit, startTime);
      const parsed = parseKlines(raw);

      if (parsed.length === 0) break;

      allCandles = allCandles.concat(parsed);
      startTime = parsed[parsed.length - 1].closeTime + 1;

      // Delay kecil agar tidak kena rate limit
      await sleep(200);
    } catch (err) {
      logger.error(`Batch ${b + 1} gagal:`, err.message);
      break;
    }
  }

  // Deduplicate berdasarkan timestamp
  const seen = new Set();
  allCandles = allCandles.filter((c) => {
    if (seen.has(c.timestamp)) return false;
    seen.add(c.timestamp);
    return true;
  });

  // Sort ascending
  allCandles.sort((a, b) => a.timestamp - b.timestamp);

  logger.info(`Total candle berhasil diambil: ${allCandles.length}`);

  // Simpan ke file
  ensureDir(C.DATA_PATH);
  saveJSON(C.DATA_PATH, allCandles);
  logger.info(`Data disimpan → ${C.DATA_PATH}`);

  // Simpan juga sebagai CSV untuk inspeksi manual
  saveCSV(allCandles, C.CSV_PATH);
  logger.info(`CSV disimpan → ${C.CSV_PATH}`);

  return allCandles;
}

function saveCSV(candles, filePath) {
  const fs = require("fs");
  ensureDir(filePath);
  const header = "timestamp,open,high,low,close,volume\n";
  const rows = candles
    .map((c) => `${c.timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume}`)
    .join("\n");
  fs.writeFileSync(filePath, header + rows);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Jalankan langsung
(async () => {
  try {
    const totalCandles = parseInt(process.argv[2]) || 5000;
    await fetchHistorical(totalCandles);
    logger.info("✅ Fetch data selesai!");
  } catch (err) {
    logger.error("Fetch gagal:", err.message);
    process.exit(1);
  }
})();
