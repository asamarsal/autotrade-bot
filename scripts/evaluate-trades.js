const fs = require("fs");
const https = require("https");
const path = require("path");
require("dotenv").config({ path: "./config/.env" });
const C = require("../config/constants");
const { logger, round } = require("../src/utils");

/**
 * Script untuk mengevaluasi hasil Paper Trading dari trades.log
 * Mengambil harga exit (5 menit kemudian) dari Binance API (Public)
 */

const LOG_FILE = path.join(__dirname, "../logs/trades.log");

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Gagal parse JSON dari Binance: ${e.message}`));
        }
      });
    }).on("error", reject);
  });
}

async function getPriceAt(timestamp) {
  // Binance klines endpoint
  // startTime adalah millisecond
  const symbol = C.BINANCE_SYMBOL || "BTCUSDT";
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${timestamp}&limit=1`;
  
  try {
    const data = await httpGet(url);
    if (data && data.length > 0) {
      // Index 4 adalah Close Price
      return parseFloat(data[0][4]);
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function evaluate() {
  if (!fs.existsSync(LOG_FILE)) {
    console.log("❌ File logs/trades.log tidak ditemukan.");
    return;
  }

  const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(l => l.trim());
  if (lines.length === 0) {
    console.log("❌ Belum ada trade yang tercatat di logs/trades.log.");
    return;
  }

  console.log(`\n🔍 Mengevaluasi ${lines.length} trade dari trades.log...\n`);
  console.log("--------------------------------------------------------------------------------");
  console.log("WAKTU MASUK          | SINYAL | HARGA MASUK | HARGA KELUAR | HASIL  | PROFIT");
  console.log("--------------------------------------------------------------------------------");

  let stats = {
    win: 0,
    loss: 0,
    pending: 0,
    totalProfit: 0
  };

  for (const line of lines) {
    const trade = JSON.parse(line);
    const entryTime = new Date(trade.timestamp).getTime();
    // Exit time adalah 5 menit (atau PREDICT_HORIZON) setelah entry
    const exitTime = entryTime + (C.PREDICT_HORIZON * 60 * 1000);
    
    // Jika waktu sekarang belum sampai waktu exit + 1 menit (untuk memastikan candle close)
    if (Date.now() < exitTime + 60000) {
      console.log(`${new Date(entryTime).toLocaleString()} | ${trade.signal.padEnd(6)} | ${trade.price.toFixed(2).padEnd(11)} | ---        | WAITING| -`);
      stats.pending++;
      continue;
    }

    const exitPrice = await getPriceAt(exitTime);
    
    if (!exitPrice) {
      console.log(`${new Date(entryTime).toLocaleString()} | ${trade.signal.padEnd(6)} | ${trade.price.toFixed(2).padEnd(11)} | ERROR API  | SKIP   | -`);
      continue;
    }

    let isWin = false;
    if (trade.signal === "UP") {
      isWin = exitPrice > trade.price;
    } else {
      isWin = exitPrice < trade.price;
    }

    const profit = isWin ? (trade.betAmount * (C.WIN_MULTIPLIER - 1)) : -trade.betAmount;
    stats.totalProfit += profit;

    if (isWin) stats.win++; else stats.loss++;

    const resultStr = isWin ? "✅ WIN " : "❌ LOSE";
    const profitStr = profit > 0 ? `+$${profit.toFixed(2)}` : `-$${Math.abs(profit).toFixed(2)}`;

    console.log(
      `${new Date(entryTime).toLocaleString()} | ${trade.signal.padEnd(6)} | ${trade.price.toFixed(2).padEnd(11)} | ${exitPrice.toFixed(2).padEnd(12)} | ${resultStr} | ${profitStr}`
    );

    // Delay kecil agar tidak kena rate limit Binance (1200 request per menit)
    await new Promise(r => setTimeout(r, 100));
  }

  const totalEvaluated = stats.win + stats.loss;
  const winRate = totalEvaluated > 0 ? (stats.win / totalEvaluated * 100).toFixed(2) : 0;

  console.log("--------------------------------------------------------------------------------");
  console.log(`\n📊 RINGKASAN PERFORMA:`);
  console.log(`   Total Trade Selesai : ${totalEvaluated}`);
  console.log(`   Menang (Win)        : ${stats.win}`);
  console.log(`   Kalah (Loss)        : ${stats.loss}`);
  console.log(`   Masih Berjalan      : ${stats.pending}`);
  console.log(`   Win Rate            : ${winRate}%`);
  console.log(`   Total Profit/Loss   : ${stats.totalProfit > 0 ? "+" : ""}$${stats.totalProfit.toFixed(2)}`);
  console.log("\n✅ Evaluasi Selesai!\n");
}

evaluate().catch(err => {
  console.error("Terjadi error saat evaluasi:", err);
});
