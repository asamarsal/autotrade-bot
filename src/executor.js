// ============================================================
// src/executor.js — Polymarket execution layer
// Mengirim order ke Polymarket berdasarkan signal dari scorer
// ============================================================

const { logger, round, appendLine, tsToDate } = require("./utils");
const C = require("../config/constants");

// ============================================================
// NOTE: Polymarket menggunakan CLOB (Central Limit Order Book)
// via smart contract di Polygon network.
// Untuk production, gunakan @polymarket/clob-client library.
// Di sini kita mock-up logic-nya + stub untuk real execution.
// ============================================================

class Executor {
  constructor() {
    this.isLive = process.env.BOT_MODE === "live";
    this.positions = []; // open positions
    this.tradeLog = C.LOG_TRADES;
    this.totalPnl = 0;
    this.tradeCount = 0;

    if (this.isLive) {
      logger.info("Executor mode: LIVE (real execution)");
      this.initPolymarket();
    } else {
      logger.info("Executor mode: PAPER (simulasi, tidak ada order sungguhan)");
    }
  }

  // Inisialisasi koneksi Polymarket
  async initPolymarket() {
    // Untuk production, install: npm install @polymarket/clob-client
    // Kemudian:
    // const { ClobClient } = require("@polymarket/clob-client");
    // this.client = new ClobClient(
    //   "https://clob.polymarket.com",
    //   137, // Polygon mainnet
    //   process.env.POLYMARKET_API_KEY,
    //   process.env.POLYMARKET_PRIVATE_KEY
    // );
    logger.info("Polymarket client initialized (stub)");
  }

  /**
   * Eksekusi trade berdasarkan signal
   * @param {Object} scoreResult - output dari Scorer.score()
   * @param {Object} market - { conditionId, tokenIdYes, tokenIdNo }
   * @param {number} balance - current balance untuk sizing
   */
  async execute(scoreResult, market, balance) {
    const { signal, pUp, pDown, price, timestamp } = scoreResult;

    if (signal === "HOLD") {
      logger.debug(`HOLD — p=${pUp}, tidak ada aksi`);
      return null;
    }

    // Kelly Criterion untuk bet sizing
    // f = (bp - q) / b
    // b = win odds (net), p = win prob, q = loss prob
    const b = C.WIN_MULTIPLIER - 1; // net odds
    const p = signal === "UP" ? pUp : pDown;
    const q = 1 - p;
    const kellyFraction = (b * p - q) / b;
    const safeFraction = Math.max(0, Math.min(kellyFraction * 0.5, C.BET_SIZE)); // half-kelly, max 2%

    // Di paper mode: jika Kelly negatif (model tidak yakin),
    // tetap catat trade dengan bet tetap kecil agar bisa evaluasi akurasi sinyal.
    // Di live mode: skip jika tidak ada edge (safeFraction = 0).
    let betAmount;
    if (!this.isLive && safeFraction === 0) {
      betAmount = round(balance * (C.PAPER_BET_SIZE || 0.01), 2); // 1% fixed paper bet
      logger.debug(`Paper mode: Kelly negatif → pakai fixed bet $${betAmount}`);
    } else {
      betAmount = round(balance * safeFraction, 2);
    }

    if (betAmount < 1) {
      logger.debug(`Bet terlalu kecil (${betAmount} USD), skip`);
      return null;
    }


    const trade = {
      id: `trade_${Date.now()}`,
      timestamp: tsToDate(timestamp),
      price,
      signal,
      pUp,
      pDown,
      betAmount,
      market: market?.conditionId || "mock",
      status: "pending",
    };

    logger.info(`📊 SIGNAL ${signal} | P=${p} | Bet=$${betAmount}`);

    if (this.isLive) {
      trade.status = await this.sendOrder(trade, market);
    } else {
      // Paper trading — simulasi instant fill
      trade.status = "filled_paper";
      logger.info(`📝 PAPER ORDER filled: ${signal} $${betAmount}`);
    }

    this.positions.push(trade);
    this.tradeCount++;
    appendLine(this.tradeLog, JSON.stringify(trade));

    return trade;
  }

  /**
   * Kirim order sungguhan ke Polymarket CLOB
   * Implementasi production menggunakan @polymarket/clob-client
   */
  async sendOrder(trade, market) {
    try {
      // --- PRODUCTION CODE (uncomment setelah install library) ---
      // const side = trade.signal === "UP" ? "buy" : "sell";
      // const tokenId = trade.signal === "UP" ? market.tokenIdYes : market.tokenIdNo;
      //
      // const order = await this.client.createAndPostOrder({
      //   tokenID: tokenId,
      //   price: trade.pUp,
      //   side: side,
      //   size: trade.betAmount,
      //   feeRateBps: 100, // 1% fee
      //   nonce: Date.now(),
      // });
      //
      // logger.info(`Order submitted: ${order.orderID}`);
      // return "filled";

      // --- STUB untuk testing ---
      logger.info(`[STUB] sendOrder: ${trade.signal} $${trade.betAmount} di market ${market?.conditionId}`);
      return "stub_filled";
    } catch (err) {
      logger.error("Order gagal:", err.message);
      return "failed";
    }
  }

  /**
   * Fetch orderbook Polymarket untuk market tertentu
   * Untuk cek spread dan likuiditas sebelum masuk
   */
  async getOrderbook(conditionId) {
    try {
      // Production:
      // const book = await this.client.getOrderBook(conditionId);
      // return { bestBid: book.bids[0], bestAsk: book.asks[0] };

      // Stub:
      return {
        bestBid: { price: 0.58, size: 500 },
        bestAsk: { price: 0.62, size: 500 },
        spread: 0.04,
        midPrice: 0.60,
      };
    } catch (err) {
      logger.error("Gagal fetch orderbook:", err.message);
      return null;
    }
  }

  /**
   * Cek apakah ada edge: probabilitas bot vs market odds
   * Edge ada kalau model kita lebih yakin dari market
   */
  checkEdge(scoreResult, orderbook) {
    if (!orderbook) return false;

    const { signal, pUp } = scoreResult;
    const marketOdds = orderbook.midPrice; // 0.60 = market thinks 60% UP

    let edge = 0;
    if (signal === "UP") {
      edge = pUp - marketOdds; // kita lebih bullish dari market
    } else if (signal === "DOWN") {
      edge = (1 - pUp) - (1 - marketOdds); // kita lebih bearish
    }

    const hasEdge = edge > 0.05; // minimal 5% edge
    logger.debug(`Edge check: model=${round(pUp, 3)}, market=${marketOdds}, edge=${round(edge, 3)}, hasEdge=${hasEdge}`);
    return hasEdge;
  }

  summary() {
    logger.info(`=== EXECUTOR SUMMARY === Trades: ${this.tradeCount} | Mode: ${this.isLive ? "LIVE" : "PAPER"}`);
  }
}

module.exports = Executor;
