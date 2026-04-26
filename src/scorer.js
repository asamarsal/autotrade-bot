// ============================================================
// src/scorer.js — scoring real-time untuk 1 candle baru
// Digunakan oleh live-bot.js
//
// Aliran:
//   scoreWithConfirmation()
//     → score() [primary - logistic regression]
//       ├── UP / DOWN → return langsung
//       └── HOLD → secondary.evaluate() [secondary gate]
//                     ├── >= +3 → override UP
//                     ├── <= -3 → override DOWN
//                     └── else → tetap HOLD
// ============================================================

const { buildFeatureAt } = require("./features");
const LogisticModel = require("./model");
const { computeAll } = require("./claude/indicators");
const { computeVote } = require("./claude/voting");
const { logger, round } = require("./utils");
const C = require("../config/constants");

class Scorer {
  constructor() {
    this.model = new LogisticModel();
    this.candles = []; // rolling buffer candle terbaru
    this.BUFFER_SIZE = 200; // simpan 200 candle terakhir
    this.secondary = { pushLiquidation: () => { } }; // dummy agar live-bot.js tidak error saat pushLiquidation
  }

  // Load model yang sudah di-train
  loadModel(filePath = C.WEIGHTS_PATH) {
    this.model.load(filePath);
  }

  // Expose secondary agar live-bot bisa push liquidation events
  getSecondary() {
    return this.secondary;
  }

  // Tambah candle baru ke buffer & recompute indikator
  addCandle(rawCandle) {
    this.candles.push(rawCandle);

    // Jaga buffer tidak terlalu besar
    if (this.candles.length > this.BUFFER_SIZE) {
      this.candles.shift();
    }

    // Recompute semua indikator di buffer
    this.candles = computeAll(this.candles, {
      EMA_FAST: C.EMA_FAST,
      EMA_SLOW: C.EMA_SLOW,
      RSI_PERIOD: C.RSI_PERIOD,
      ATR_PERIOD: C.ATR_PERIOD,
      VOLUME_MA_PERIOD: C.VOLUME_MA_PERIOD,
    });
  }

  // Scoring candle terakhir di buffer (primary model saja)
  score() {
    if (this.candles.length < C.WARMUP_CANDLES) {
      return { ready: false, reason: `Buffer baru ${this.candles.length}/${C.WARMUP_CANDLES} candle` };
    }

    const lastIdx = this.candles.length - 1;
    const feat = buildFeatureAt(this.candles, lastIdx);

    if (feat === null) {
      return { ready: false, reason: "Indikator belum lengkap" };
    }

    const pUp = this.model.predict(feat);
    const pDown = 1 - pUp;
    const candle = this.candles[lastIdx];

    const signal = this.interpretSignal(pUp);

    return {
      ready: true,
      timestamp: candle.timestamp,
      price: candle.close,
      pUp: round(pUp, 4),
      pDown: round(pDown, 4),
      signal,        // "UP" | "DOWN" | "HOLD"
      confidence: round(Math.max(pUp, pDown), 4),
      features: feat,
      source: "primary", // dari model utama
      secondaryResult: null, // akan diisi oleh scoreWithConfirmation
      indicators: {
        ema9: round(candle.ema9, 2),
        ema21: round(candle.ema21, 2),
        rsi: round(candle.rsi, 2),
        atr: round(candle.atr, 2),
        vwap: round(candle.vwap, 2),
        cvd: round(candle.cvd, 0),
      },
    };
  }

  // ============================================================
  // scoreWithConfirmation() — entry point utama untuk live-bot
  //
  // Jika primary = HOLD, jalankan secondary gate
  // Secondary gate mengambil OI, Funding, Liquidation, CVD, OB
  // dan memberi skor agregat untuk memutuskan override atau tidak
  // ============================================================
  async scoreWithConfirmation() {
    const primary = this.score();

    // Tidak siap — return as-is
    if (!primary.ready) return primary;

    // Primary sudah yakin — tidak perlu secondary
    if (primary.signal !== "HOLD") {
      logger.debug(`Primary: ${primary.signal} (P=${primary.pUp}, confidence tinggi — skip secondary)`);
      return primary;
    }

    // Primary HOLD → aktifkan secondary gate
    logger.info(`⚪ Primary HOLD (P=${primary.pUp}) → Activating secondary gate (Claude Voting 10 Indicators)...`);

    try {
      const candle = this.candles[this.candles.length - 1];
      const prev = this.candles.length > 1 ? this.candles[this.candles.length - 2] : null;

      // Panggil fungsi voting baru
      const secondaryResult = computeVote(candle, prev, {
        threshold: 5,          // min 5/10 indikator untuk eksekusi
        scoreThreshold: 3,     // net score ±3 untuk displaySignal
        requireWindow: true,
      });

      const finalSignal = secondaryResult.signal !== "HOLD"
        ? secondaryResult.signal  // secondary berhasil override
        : "HOLD";                 // secondary juga tidak yakin → HOLD final

      const source = secondaryResult.signal !== "HOLD" ? "secondary_override" : "primary";

      // Log sinyal tampilan (displaySignal) — selalu muncul meski tidak trade
      const dIcon = secondaryResult.displaySignal === "UP" ? "🟢" : secondaryResult.displaySignal === "DOWN" ? "🔴" : "⚪";
      logger.info(`${dIcon} Display=${secondaryResult.displaySignal} (score=${secondaryResult.score >= 0 ? "+" : ""}${secondaryResult.score}) | Action=${finalSignal} | UP:${secondaryResult.upCount} DOWN:${secondaryResult.downCount}`);

      if (secondaryResult.signal !== "HOLD") {
        logger.info(`✅ Secondary override: HOLD → ${finalSignal} (${secondaryResult.upCount} indikator sepakat)`);
      } else {
        logger.info(`⚪ Secondary: tidak cukup untuk eksekusi (butuh 5 indikator, dapat ${Math.max(secondaryResult.upCount, secondaryResult.downCount)})`);
      }

      // Log detail voting
      logger.info(secondaryResult.breakdown);

      return {
        ...primary,
        signal: finalSignal,
        source,
        secondaryResult,
      };
    } catch (err) {
      logger.error(`Secondary gate error: ${err.message} — fallback ke HOLD`);
      return { ...primary, signal: "HOLD", source: "secondary_error" };
    }
  }

  interpretSignal(pUp) {
    if (pUp >= C.THRESHOLD_UP) return "UP";
    if (pUp <= C.THRESHOLD_DOWN) return "DOWN";
    return "HOLD";
  }
}

module.exports = Scorer;
