// ============================================================
// src/features.js — ubah candle+indikator → feature vector
// Output: { features: [[x1,x2,...]], labels: [0/1] }
// ============================================================

const C = require("../config/constants");

/**
 * Normalize sebuah nilai ke range [-1, 1]
 * menggunakan min-max dari window terakhir
 */
function normalizeRSI(rsi) {
    // RSI 0-100 → normalize ke -1 ~ +1
    return (rsi - 50) / 50;
}

/**
 * Build feature vector untuk 1 candle pada index i
 * Returns null jika data belum cukup
 *
 * FEATURES:
 * [0] ema_signal       : trend direction EMA9 vs EMA21
 * [1] rsi_signal       : momentum RSI7
 * [2] vwap_signal      : price vs VWAP (institutional level)
 * [3] volume_signal    : volume spike vs average
 * [4] volatility_signal: ATR relatif ke harga
 * [5] cvd_signal       : cumulative volume delta direction
 */
function buildFeatureAt(candles, i) {
    const c = candles[i];

    // cek semua indikator tersedia
    if (
        c.ema9 === null || c.ema21 === null ||
        c.rsi === null || c.atr === null ||
        c.vwap === null || c.volMA === null
    ) return null;

    // [0] EMA Signal: crossover direction
    const emaDiff = (c.ema9 - c.ema21) / c.ema21; // normalized pct
    const emaSignal = emaDiff > 0 ? 1 : -1;

    // [1] RSI Signal: overbought/oversold
    let rsiSignal;
    if (c.rsi < 30) rsiSignal = 1;       // oversold → kemungkinan naik
    else if (c.rsi > 70) rsiSignal = -1; // overbought → kemungkinan turun
    else rsiSignal = normalizeRSI(c.rsi); // middle zone: linear

    // [2] VWAP Signal: apakah harga di atas/bawah VWAP
    const vwapSignal = c.close > c.vwap ? 1 : -1;

    // [3] Volume Signal: apakah volume lebih tinggi dari rata-rata
    const volRatio = c.volume / (c.volMA || 1);
    const volumeSignal = volRatio > 1.5 ? 1 : volRatio < 0.5 ? -1 : 0;

    // [4] Volatility Signal: ATR sebagai % dari harga
    const atrPct = c.atr / c.close;
    const atrAvg = 0.003; // ~0.3% ATR normal untuk BTC 1m
    const volatilitySignal = atrPct > atrAvg * 1.5 ? 1 : 0;

    // [5] CVD Signal: arah tekanan beli/jual
    // Bandingkan CVD sekarang vs 5 candle lalu
    const prevIdx = Math.max(0, i - 5);
    const cvdChange = c.cvd - candles[prevIdx].cvd;
    const cvdSignal = cvdChange > 0 ? 1 : -1;

    return [emaSignal, rsiSignal, vwapSignal, volumeSignal, volatilitySignal, cvdSignal];
}

/**
 * Build semua feature + label dari array candle
 * Label: 1 jika harga naik dalam HORIZON candle ke depan
 */
function buildFeatures(candles, horizon = C.PREDICT_HORIZON) {
    const features = [];
    const labels = [];
    const indices = []; // simpan index untuk debug

    const warmup = C.WARMUP_CANDLES;

    for (let i = warmup; i < candles.length - horizon; i++) {
        const feat = buildFeatureAt(candles, i);
        if (feat === null) continue;

        const futurePrice = candles[i + horizon].close;
        const currentPrice = candles[i].close;
        const label = futurePrice > currentPrice ? 1 : 0;

        features.push(feat);
        labels.push(label);
        indices.push(i);
    }

    return { features, labels, indices };
}

/**
 * Split data menjadi train/test (default 80/20)
 */
function trainTestSplit(features, labels, trainRatio = 0.8) {
    const splitIdx = Math.floor(features.length * trainRatio);
    return {
        trainX: features.slice(0, splitIdx),
        trainY: labels.slice(0, splitIdx),
        testX: features.slice(splitIdx),
        testY: labels.slice(splitIdx),
    };
}

module.exports = { buildFeatures, buildFeatureAt, trainTestSplit };
