// ============================================================
// scripts/run-backtest.js — jalankan backtest & cetak report
// Jalankan: node scripts/run-backtest.js
// ============================================================

require("dotenv").config({ path: "./config/.env" });

const { loadJSON, logger, round } = require("../src/utils");
const { computeAll } = require("../src/indicators");
const { runBacktest, walkForward } = require("../src/backtest");
const LogisticModel = require("../src/model");
const C = require("../config/constants");

async function main() {
  logger.info("=== BACKTEST DIMULAI ===");

  // 1. Load data
  let candles;
  try {
    candles = loadJSON(C.DATA_PATH);
  } catch {
    logger.error("Data tidak ada. Jalankan: node scripts/fetch-data.js");
    process.exit(1);
  }

  // 2. Hitung indikator
  const withIndicators = computeAll(candles, {
    EMA_FAST: C.EMA_FAST,
    EMA_SLOW: C.EMA_SLOW,
    RSI_PERIOD: C.RSI_PERIOD,
    ATR_PERIOD: C.ATR_PERIOD,
    VOLUME_MA_PERIOD: C.VOLUME_MA_PERIOD,
  });

  // 3. Load model
  const model = new LogisticModel(C.N_FEATURES);
  try {
    model.load(C.WEIGHTS_PATH);
  } catch {
    logger.error("Model tidak ada. Jalankan dulu: node scripts/train.js");
    process.exit(1);
  }

  // 4. Jalankan backtest
  logger.info("Menjalankan backtest...");
  const { stats, equityCurve, trades } = runBacktest(withIndicators, model);

  // 5. Cetak report lengkap
  printReport(stats, equityCurve, trades);

  // 6. Walk-forward validation (opsional)
  logger.info("\nMenjalankan walk-forward validation...");
  const wfResult = walkForward(withIndicators, model, 5);

  console.log("\n┌─────────────────────────────────────┐");
  console.log("│       WALK-FORWARD VALIDATION        │");
  console.log("├─────────────────────────────────────┤");
  wfResult.results.forEach((r) => {
    console.log(`│ Fold ${r.fold}: acc=${r.accuracy} | trades=${String(r.tradeCount).padEnd(4)} | cov=${r.coverage} │`);
  });
  console.log(`├─────────────────────────────────────┤`);
  console.log(`│ Avg accuracy : ${wfResult.avgAccuracy}                   │`);
  console.log("└─────────────────────────────────────┘\n");

  logger.info(`✅ Backtest selesai. Log tersimpan di ${C.LOG_BACKTEST}`);
  logger.info(`📊 Equity curve tersimpan di ${C.LOG_EQUITY}`);
}

function printReport(stats, equityCurve, trades) {
  const line = "─".repeat(40);

  console.log(`\n╔${"═".repeat(40)}╗`);
  console.log("║          BACKTEST REPORT                 ║");
  console.log(`╠${"═".repeat(40)}╣`);

  const rows = [
    ["Total candle dianalisis", stats.totalCandles],
    ["Total trades", stats.totalTrades],
    ["HOLD (tidak trade)", stats.hold],
    ["Coverage", `${round(stats.coverage * 100, 1)}%`],
    [line, ""],
    ["WIN", stats.win],
    ["LOSS", stats.loss],
    ["Win Rate", `${round(stats.winRate * 100, 2)}%`],
    [line, ""],
    ["Initial balance", `$${stats.initialBalance}`],
    ["Final balance", `$${stats.finalBalance}`],
    ["ROI", `${stats.roiPct}`],
    [line, ""],
    ["Max Drawdown", `${stats.maxDrawdownPct}`],
    ["Profit Factor", stats.profitFactor],
    ["Expectancy/trade", `$${stats.expectancy}`],
    ["Sharpe (approx)", stats.sharpeApprox],
    [line, ""],
    ["Max consec. wins", stats.maxConsecWins],
    ["Max consec. losses", stats.maxConsecLosses],
  ];

  rows.forEach(([label, val]) => {
    if (val === "") {
      console.log(`║ ${label} ║`);
    } else {
      const l = String(label).padEnd(24);
      const v = String(val).padStart(14);
      console.log(`║ ${l}${v} ║`);
    }
  });

  console.log(`╚${"═".repeat(40)}╝`);

  // Equity curve mini (ASCII)
  console.log("\n📈 EQUITY CURVE (mini):");
  const sample = equityCurve.filter((_, i) => i % Math.ceil(equityCurve.length / 40) === 0);
  const vals = sample.map((e) => e.balance);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const height = 8;

  const rows2 = Array.from({ length: height }, () => Array(sample.length).fill(" "));
  vals.forEach((v, col) => {
    const row = Math.round(((maxV - v) / range) * (height - 1));
    rows2[row][col] = "█";
  });

  rows2.forEach((row, i) => {
    const label = i === 0 ? `$${round(maxV, 0)}` : i === height - 1 ? `$${round(minV, 0)}` : "      ";
    console.log(`${label.padStart(8)} │${row.join("")}│`);
  });
  console.log(" ".repeat(9) + "└" + "─".repeat(sample.length) + "┘");

  // Recent trades (5 terakhir)
  console.log("\n📋 5 TRADE TERAKHIR:");
  const recent = trades.slice(-5);
  recent.forEach((t) => {
    const icon = t.result === "WIN" ? "✅" : "❌";
    console.log(`  ${icon} [${t.ts}] ${t.signal} | P=${t.pUp} | Bet=$${t.betAmount} | PnL=$${t.pnl} | Bal=$${t.balance}`);
  });
}

main().catch((err) => {
  logger.error("Backtest gagal:", err.message);
  console.error(err);
  process.exit(1);
});
