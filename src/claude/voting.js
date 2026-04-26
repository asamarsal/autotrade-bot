// ============================================================
// src/voting.js — Sistem Voting 10 Indikator
//
// LOGIKA UTAMA:
//   - Setiap indikator vote: +1 (UP), -1 (DOWN), 0 (NEUTRAL)
//
//   displaySignal (informasi, selalu muncul):
//     score >= +3 → UP, score <= -3 → DOWN, else → HOLD
//
//   signal / actionSignal (untuk eksekusi trade):
//     upCount >= threshold (default 5) → UP
//     downCount >= threshold          → DOWN
//     else                            → HOLD
//     + hanya aktif di window 5 menit BTC (requireWindow)
//
// THRESHOLD default = 5 dari 10 indikator
// SCORE_THRESHOLD default = 3 (untuk displaySignal)
// ============================================================

// ─────────────────────────────────────────────
// HELPER: cek apakah timestamp masuk window 5 menit
// Window: menit ke-0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55
// Toleransi ±30 detik dari pembukaan window
// ─────────────────────────────────────────────
function isIn5MinWindow(timestamp, toleranceSec = 30) {
    const date = new Date(timestamp);
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();

    const isOnWindow = minutes % 5 === 0;
    const isNearWindow =
        (minutes % 5 === 0 && seconds <= toleranceSec) ||
        (minutes % 5 === 4 && seconds >= 60 - toleranceSec);

    return isNearWindow || isOnWindow;
}

// ─────────────────────────────────────────────
// 10 FUNGSI VOTING INDIVIDUAL
// Setiap fungsi terima objek candle (sudah enriched dengan computeAll)
// plus candle sebelumnya (prev) untuk perbandingan.
// Return: +1 (UP) | -1 (DOWN) | 0 (NEUTRAL)
// ─────────────────────────────────────────────

/**
 * V1: EMA Cross — EMA9 vs EMA21
 * UP jika EMA9 > EMA21, DOWN jika EMA9 < EMA21
 */
function voteEmaCross(candle) {
    if (candle.ema9 === null || candle.ema21 === null) return 0;
    if (candle.ema9 > candle.ema21) return +1;
    if (candle.ema9 < candle.ema21) return -1;
    return 0;
}

/**
 * V2: RSI
 * UP jika RSI < 50 (momentum mulai naik / oversold zone)
 * DOWN jika RSI > 50
 * NEUTRAL jika RSI 48–52 (dead zone)
 */
function voteRsi(candle) {
    if (candle.rsi === null) return 0;
    if (candle.rsi < 48) return +1;
    if (candle.rsi > 52) return -1;
    return 0;
}

/**
 * V3: MACD Histogram
 * UP jika histogram > 0 (MACD line di atas signal)
 * DOWN jika histogram < 0
 */
function voteMacd(candle) {
    if (candle.macdHist === null) return 0;
    if (candle.macdHist > 0) return +1;
    if (candle.macdHist < 0) return -1;
    return 0;
}

/**
 * V4: MACD Crossover (perubahan arah histogram)
 * UP jika histogram baru positif & sebelumnya negatif (golden cross)
 * DOWN jika histogram baru negatif & sebelumnya positif (death cross)
 */
function voteMacdCross(candle, prev) {
    if (!prev || candle.macdHist === null || prev.macdHist === null) return 0;
    if (candle.macdHist > 0 && prev.macdHist <= 0) return +1;
    if (candle.macdHist < 0 && prev.macdHist >= 0) return -1;
    return 0;
}

/**
 * V5: Bollinger Bands Position
 * UP jika harga dekat BB Lower (oversold / reversal)
 * DOWN jika harga dekat BB Upper (overbought / reversal)
 * NEUTRAL jika di tengah
 */
function voteBollinger(candle) {
    if (candle.bbUpper === null || candle.bbLower === null) return 0;
    const range = candle.bbUpper - candle.bbLower;
    if (range === 0) return 0;

    const pos = (candle.close - candle.bbLower) / range; // 0 = bawah, 1 = atas

    if (pos < 0.25) return +1;  // dekat lower band → potensi naik
    if (pos > 0.75) return -1;  // dekat upper band → potensi turun
    return 0;
}

/**
 * V6: Stochastic %K vs %D
 * UP jika %K > %D dan keduanya < 50 (momentum naik dari oversold)
 * DOWN jika %K < %D dan keduanya > 50 (momentum turun dari overbought)
 */
function voteStochastic(candle) {
    if (candle.stochK === null || candle.stochD === null) return 0;
    if (candle.stochK > candle.stochD && candle.stochK < 50) return +1;
    if (candle.stochK < candle.stochD && candle.stochK > 50) return -1;
    return 0;
}

/**
 * V7: VWAP Position
 * UP jika harga di atas VWAP (bullish bias)
 * DOWN jika harga di bawah VWAP
 */
function voteVwap(candle) {
    if (candle.vwap === null) return 0;
    if (candle.close > candle.vwap) return +1;
    if (candle.close < candle.vwap) return -1;
    return 0;
}

/**
 * V8: Volume Surge
 * UP jika volume > 1.5x volMA DAN candle bullish (close > open)
 * DOWN jika volume > 1.5x volMA DAN candle bearish (close < open)
 * NEUTRAL jika volume normal
 */
function voteVolume(candle) {
    if (candle.volMA === null || candle.volume === null) return 0;
    const isSurge = candle.volume > candle.volMA * 1.5;
    if (!isSurge) return 0;

    if (candle.close > candle.open) return +1;
    if (candle.close < candle.open) return -1;
    return 0;
}

/**
 * V9: CVD Trend (Cumulative Volume Delta)
 * UP jika CVD sekarang > CVD sebelumnya (buy pressure dominan)
 * DOWN jika CVD sekarang < CVD sebelumnya
 */
function voteCvd(candle, prev) {
    if (!prev || candle.cvd === null || prev.cvd === null) return 0;
    if (candle.cvd > prev.cvd) return +1;
    if (candle.cvd < prev.cvd) return -1;
    return 0;
}

/**
 * V10: Price vs EMA9 Momentum
 * UP jika harga close di atas EMA9 DAN EMA9 trending naik
 * DOWN jika harga close di bawah EMA9 DAN EMA9 trending turun
 */
function votePriceEma(candle, prev) {
    if (!prev || candle.ema9 === null || prev.ema9 === null) return 0;
    const emaRising = candle.ema9 > prev.ema9;
    const emaFalling = candle.ema9 < prev.ema9;

    if (candle.close > candle.ema9 && emaRising) return +1;
    if (candle.close < candle.ema9 && emaFalling) return -1;
    return 0;
}

// ─────────────────────────────────────────────
// FUNGSI UTAMA: computeVote
//
// Input:
//   candle       — candle terkini (sudah di-enrich computeAll)
//   prev         — candle sebelumnya (untuk perbandingan delta)
//   options      — {
//     threshold:      5,    // min upCount/downCount untuk eksekusi trade
//     scoreThreshold: 3,    // min |score| untuk displaySignal
//     requireWindow:  true, // hanya entry di window 5 menit
//     toleranceSec:   30,
//   }
//
// Output: {
//   signal:        'UP' | 'DOWN' | 'HOLD',  // sinyal eksekusi (threshold count)
//   displaySignal: 'UP' | 'DOWN' | 'HOLD',  // sinyal tampilan (net score ±3)
//   score:         number (-10 to +10),
//   votes:         { v1..v10: +1/-1/0 },
//   inWindow:      boolean,
//   breakdown:     string (untuk logging),
// }
// ─────────────────────────────────────────────
function computeVote(candle, prev = null, options = {}) {
    const {
        threshold = 5,          // min indikator sepakat untuk trade
        scoreThreshold = 3,     // net score untuk displaySignal
        requireWindow = true,   // hanya entry di window 5 menit
        toleranceSec = 30,      // toleransi detik masuk window
    } = options;

    // Hitung semua vote
    const votes = {
        v1_emaCross: voteEmaCross(candle),
        v2_rsi: voteRsi(candle),
        v3_macdHist: voteMacd(candle),
        v4_macdCross: voteMacdCross(candle, prev),
        v5_bollinger: voteBollinger(candle),
        v6_stochastic: voteStochastic(candle),
        v7_vwap: voteVwap(candle),
        v8_volume: voteVolume(candle),
        v9_cvd: voteCvd(candle, prev),
        v10_priceEma: votePriceEma(candle, prev),
    };

    const voteValues = Object.values(votes);
    const upCount = voteValues.filter((v) => v === +1).length;
    const downCount = voteValues.filter((v) => v === -1).length;
    const score = upCount - downCount; // -10 to +10

    // Cek apakah sedang di window 5 menit
    const inWindow = isIn5MinWindow(candle.timestamp, toleranceSec);

    // ── displaySignal: selalu muncul, berdasarkan net score (informatif) ──
    let displaySignal = "HOLD";
    if (score >= scoreThreshold) displaySignal = "UP";
    else if (score <= -scoreThreshold) displaySignal = "DOWN";

    // ── actionSignal: untuk eksekusi trade, berdasarkan count threshold ──
    let rawSignal = "HOLD";
    if (upCount >= threshold) rawSignal = "UP";
    else if (downCount >= threshold) rawSignal = "DOWN";

    // Jika requireWindow aktif, hanya trade di window 5 menit
    const signal = requireWindow && !inWindow ? "HOLD" : rawSignal;

    // Breakdown string untuk logging
    const voteStr = voteValues
        .map((v, i) => {
            const name = Object.keys(votes)[i].replace(/v\d+_/, "");
            const icon = v === +1 ? "🟢" : v === -1 ? "🔴" : "⚪";
            return `${icon}${name}`;
        })
        .join(" | ");

    const displayIcon = displaySignal === "UP" ? "🟢" : displaySignal === "DOWN" ? "🔴" : "⚪";
    const actionIcon = signal === "UP" ? "🟢" : signal === "DOWN" ? "🔴" : "⚪";

    const breakdown =
        `[VOTE] Score=${score >= 0 ? "+" : ""}${score} ` +
        `(UP:${upCount} DOWN:${downCount}) ` +
        `Window=${inWindow ? "✅" : "❌"} ` +
        `| Display=${displayIcon}${displaySignal} | Action=${actionIcon}${signal}\n` +
        `       ${voteStr}`;

    return { signal, displaySignal, score, upCount, downCount, votes, inWindow, breakdown };
}

// ─────────────────────────────────────────────
// Contoh penggunaan di bot utama:
//
//   const { computeVote } = require("./voting");
//
//   // Di dalam loop candle:
//   const enriched = computeAll(candles);
//   const candle   = enriched[enriched.length - 1];
//   const prev     = enriched[enriched.length - 2];
//
//   const result = computeVote(candle, prev, { threshold: 7 });
//   logger.info(result.breakdown);
//
//   if (result.signal === "UP") {
//     // buka LONG position
//   } else if (result.signal === "DOWN") {
//     // buka SHORT position
//   }
// ─────────────────────────────────────────────

module.exports = {
    computeVote,
    isIn5MinWindow,
    // Export individual voters untuk unit testing
    voteEmaCross, voteRsi, voteMacd, voteMacdCross,
    voteBollinger, voteStochastic, voteVwap,
    voteVolume, voteCvd, votePriceEma,
};