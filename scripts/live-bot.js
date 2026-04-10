// ============================================================
// scripts/live-bot.js — live bot via Binance WebSocket
// Jalankan: node scripts/live-bot.js
// ============================================================

require("dotenv").config({ path: "./config/.env" });

const WebSocket = require("ws");
const Scorer = require("../src/scorer");
const Executor = require("../src/executor");
const { logger, round } = require("../src/utils");
const C = require("../config/constants");

// ============================================================
// KONFIGURASI MARKET POLYMARKET
// Ganti dengan conditionId market yang ingin di-trade
// Contoh: "Will BTC be above $100k on Dec 31?"
// ============================================================
const POLYMARKET_MARKET = {
  conditionId: "0x1234567890abcdef", // ganti dengan market ID asli
  tokenIdYes: "token_yes_id",
  tokenIdNo: "token_no_id",
  description: "BTC price target market",
};

class LiveBot {
  constructor() {
    this.scorer = new Scorer();
    this.executor = new Executor();
    this.balance = parseFloat(process.env.STARTING_BALANCE || "1000");
    this.ws = null;
    this.wsLiquid = null; // WebSocket untuk liquidation stream
    this.isRunning = false;
    this.reconnectTimer = null;
    this.candleBuffer = {}; // untuk merakit candle 1m dari tick
    this.statsInterval = null;

    // Stats
    this.stats = {
      startTime: Date.now(),
      candlesProcessed: 0,
      signalsGenerated: 0,
      tradesExecuted: 0,
      upSignals: 0,
      downSignals: 0,
      holdSignals: 0,
    };
  }

  async start() {
    logger.info("=== BOT LIVE DIMULAI ===");
    logger.info(`Pair: ${C.BINANCE_SYMBOL} | Mode: ${process.env.BOT_MODE || "paper"}`);
    logger.info(`Balance: $${this.balance}`);

    // Load model yang sudah di-train
    try {
      this.scorer.loadModel(C.WEIGHTS_PATH);
    } catch (err) {
      logger.error("Model tidak ditemukan. Jalankan dulu: node scripts/train.js");
      process.exit(1);
    }

    // Pre-load historical candle ke scorer buffer
    await this.preloadHistory();

    // Mulai WebSocket kline
    this.connect();

    // Mulai WebSocket liquidation stream (untuk secondary gate)
    this.connectLiquidation();

    // Print stats setiap 30 detik
    this.statsInterval = setInterval(() => this.printStats(), 30000);

    // Graceful shutdown
    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());
  }

  // Load candle historis terbaru untuk warmup scorer
  async preloadHistory() {
    logger.info("Pre-load data historis untuk warmup...");
    try {
      const { loadJSON } = require("../src/utils");
      const { computeAll } = require("../src/indicators");

      const rawCandles = loadJSON(C.DATA_PATH);
      // Ambil 100 candle terakhir untuk warmup buffer
      const recent = rawCandles.slice(-100);
      const withIndicators = computeAll(recent, C);

      withIndicators.forEach((c) => this.scorer.addCandle(c));
      logger.info(`Buffer warmup: ${withIndicators.length} candle dimuat`);
    } catch (err) {
      logger.info("Tidak ada data historis lokal, bot akan warmup dari WebSocket...");
    }
  }

  // Koneksi WebSocket ke Binance
  connect() {
    const symbol = C.BINANCE_SYMBOL.toLowerCase();
    const wsUrl = `wss://stream.binance.com:9443/ws/${symbol}@kline_1m`;

    logger.info(`Connecting WebSocket: ${wsUrl}`);
    this.ws = new WebSocket(wsUrl);

    this.ws.on("open", () => {
      this.isRunning = true;
      logger.info("✅ WebSocket connected!");
    });

    this.ws.on("message", (data) => {
      this.onMessage(JSON.parse(data.toString()));
    });

    this.ws.on("error", (err) => {
      logger.error("WebSocket error:", err.message);
    });

    this.ws.on("close", () => {
      this.isRunning = false;
      logger.info(`WebSocket closed. Reconnect dalam ${C.WS_RECONNECT_DELAY}ms...`);
      this.reconnectTimer = setTimeout(() => this.connect(), C.WS_RECONNECT_DELAY);
    });
  }

  // Koneksi WebSocket liquidation stream (forceOrder)
  connectLiquidation() {
    const symbol = C.BINANCE_SYMBOL.toLowerCase();
    const wsUrl = `wss://fstream.binance.com/stream?streams=${symbol}@forceOrder`;

    logger.info(`Liquidation stream: ${wsUrl}`);
    this.wsLiquid = new WebSocket(wsUrl);

    this.wsLiquid.on("open", () => logger.info("✅ Liquidation stream connected!"));

    this.wsLiquid.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const order = msg?.data?.o;
        if (!order) return;

        // side: "BUY" = short position dilikuidasi, "SELL" = long position dilikuidasi
        const side = order.S === "BUY" ? "SHORT" : "LONG";
        const qty = parseFloat(order.q);
        this.scorer.getSecondary().pushLiquidation(side, qty);
        logger.debug(`⚡ Liquidation: ${side} ${qty} @ ${order.p}`);
      } catch (e) {
        logger.debug(`Liquidation WS parse error: ${e.message}`);
      }
    });

    this.wsLiquid.on("error", (err) => logger.error("Liquidation WS error:", err.message));

    this.wsLiquid.on("close", () => {
      logger.info("Liquidation stream closed. Reconnect dalam 5s...");
      setTimeout(() => this.connectLiquidation(), 5000);
    });
  }

  // Proses setiap message dari Binance
  async onMessage(msg) {
    if (!msg.k) return; // bukan kline data

    const k = msg.k;
    const candle = {
      timestamp: k.t,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      isClosed: k.x, // true = candle 1m sudah selesai (closed)
    };

    // Hanya proses candle yang sudah closed (bukan realtime tick)
    if (!candle.isClosed) return;

    this.stats.candlesProcessed++;
    logger.debug(`Candle closed: ${new Date(candle.timestamp).toISOString()} | Close: $${candle.close}`);

    // Tambah ke scorer buffer
    this.scorer.addCandle(candle);

    // Scoring (primary + secondary confirmation jika HOLD)
    const result = await this.scorer.scoreWithConfirmation();

    if (!result.ready) {
      logger.debug(`Scorer belum siap: ${result.reason}`);
      return;
    }

    this.stats.signalsGenerated++;

    // Log setiap signal
    const icon = result.signal === "UP" ? "🟢" : result.signal === "DOWN" ? "🔴" : "⚪";
    const sourceTag = result.source === "secondary_override" ? " [SECONDARY OVERRIDE]" : "";
    logger.info(
      `${icon} ${result.signal}${sourceTag} | P↑=${result.pUp} | P↓=${result.pDown} | Price=$${result.price} | RSI=${result.indicators.rsi} | EMA9=${result.indicators.ema9}`
    );

    // Update stats
    if (result.signal === "UP") this.stats.upSignals++;
    else if (result.signal === "DOWN") this.stats.downSignals++;
    else this.stats.holdSignals++;

    // Eksekusi jika ada signal
    if (result.signal !== "HOLD") {
      // Cek edge vs Polymarket odds
      const orderbook = await this.executor.getOrderbook(POLYMARKET_MARKET.conditionId);
      const hasEdge = this.executor.checkEdge(result, orderbook);

      if (hasEdge || process.env.BOT_MODE !== "live") {
        const trade = await this.executor.execute(result, POLYMARKET_MARKET, this.balance);
        if (trade) {
          this.stats.tradesExecuted++;
          logger.info(`💰 Trade executed: ${trade.signal} $${trade.betAmount}`);
        }
      } else {
        logger.info(`⚡ Tidak ada edge vs market odds, skip trade`);
      }
    }
  }

  printStats() {
    const uptime = round((Date.now() - this.stats.startTime) / 1000 / 60, 1);
    logger.info(`\n=== STATS (uptime: ${uptime} min) ===`);
    logger.info(`  Candles: ${this.stats.candlesProcessed} | Signals: ${this.stats.signalsGenerated}`);
    logger.info(`  UP: ${this.stats.upSignals} | DOWN: ${this.stats.downSignals} | HOLD: ${this.stats.holdSignals}`);
    logger.info(`  Trades executed: ${this.stats.tradesExecuted}`);
  }

  shutdown() {
    logger.info("Shutting down bot...");
    this.isRunning = false;
    clearInterval(this.statsInterval);
    clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.terminate();
    if (this.wsLiquid) this.wsLiquid.terminate();
    this.executor.summary();
    logger.info("Bot stopped.");
    process.exit(0);
  }
}

// Start bot
const bot = new LiveBot();
bot.start().catch((err) => {
  logger.error("Bot crash:", err.message);
  console.error(err);
  process.exit(1);
});
