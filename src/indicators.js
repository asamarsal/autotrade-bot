// ============================================================
// src/indicators.js — kalkulasi indikator teknikal
// Semua fungsi murni: input array → output array
// ============================================================

const { mean } = require("./utils");

// --- EMA (Exponential Moving Average) ---
// Returns array panjang sama dengan input
function ema(closes, period) {
    if (closes.length < period) return closes.map(() => null);
    const k = 2 / (period + 1);
    const result = new Array(closes.length).fill(null);

    // seed: SMA dari periode pertama
    let emaVal = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result[period - 1] = emaVal;

    for (let i = period; i < closes.length; i++) {
        emaVal = closes[i] * k + emaVal * (1 - k);
        result[i] = emaVal;
    }
    return result;
}

// --- RSI (Relative Strength Index) ---
function rsi(closes, period = 14) {
    const result = new Array(closes.length).fill(null);
    if (closes.length < period + 1) return result;

    let avgGain = 0;
    let avgLoss = 0;

    // initial average gain/loss
    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) avgGain += change;
        else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;

    const rs = avgGain / (avgLoss || 0.0001);
    result[period] = 100 - 100 / (1 + rs);

    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        const rs2 = avgGain / (avgLoss || 0.0001);
        result[i] = 100 - 100 / (1 + rs2);
    }
    return result;
}

// --- ATR (Average True Range) ---
function atr(highs, lows, closes, period = 14) {
    const result = new Array(closes.length).fill(null);
    if (closes.length < period + 1) return result;

    // True Range per candle
    const tr = closes.map((c, i) => {
        if (i === 0) return highs[i] - lows[i];
        const prevClose = closes[i - 1];
        return Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - prevClose),
            Math.abs(lows[i] - prevClose)
        );
    });

    // initial ATR = SMA dari TR
    let atrVal = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
    result[period] = atrVal;

    for (let i = period + 1; i < closes.length; i++) {
        atrVal = (atrVal * (period - 1) + tr[i]) / period;
        result[i] = atrVal;
    }
    return result;
}

// --- VWAP (Volume Weighted Average Price) ---
// VWAP direset setiap hari (daily VWAP)
function vwap(highs, lows, closes, volumes, timestamps) {
    const result = new Array(closes.length).fill(null);
    let cumTPV = 0; // cumulative typical price * volume
    let cumVol = 0;
    let currentDay = null;

    for (let i = 0; i < closes.length; i++) {
        const day = new Date(timestamps[i]).toDateString();

        // reset di hari baru
        if (day !== currentDay) {
            currentDay = day;
            cumTPV = 0;
            cumVol = 0;
        }

        const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
        cumTPV += typicalPrice * volumes[i];
        cumVol += volumes[i];
        result[i] = cumVol > 0 ? cumTPV / cumVol : closes[i];
    }
    return result;
}

// --- Volume Moving Average ---
function volumeMA(volumes, period = 20) {
    const result = new Array(volumes.length).fill(null);
    for (let i = period - 1; i < volumes.length; i++) {
        const slice = volumes.slice(i - period + 1, i + 1);
        result[i] = slice.reduce((a, b) => a + b, 0) / period;
    }
    return result;
}

// --- CVD Approximation (Cumulative Volume Delta) ---
// Approx: kalau close > open → buy volume, else sell volume
function cvd(opens, closes, volumes) {
    let cumDelta = 0;
    return closes.map((close, i) => {
        const delta = close >= opens[i] ? volumes[i] : -volumes[i];
        cumDelta += delta;
        return cumDelta;
    });
}

// --- Compute all indicators on candle array ---
// Input: array of { timestamp, open, high, low, close, volume }
// Output: sama array dengan tambahan field indicator
function computeAll(candles, cfg = {}) {
    const {
        EMA_FAST = 9,
        EMA_SLOW = 21,
        RSI_PERIOD = 7,
        ATR_PERIOD = 14,
        VOLUME_MA_PERIOD = 20,
    } = cfg;

    const opens = candles.map((c) => c.open);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);
    const timestamps = candles.map((c) => c.timestamp);

    const ema9 = ema(closes, EMA_FAST);
    const ema21 = ema(closes, EMA_SLOW);
    const rsiArr = rsi(closes, RSI_PERIOD);
    const atrArr = atr(highs, lows, closes, ATR_PERIOD);
    const vwapArr = vwap(highs, lows, closes, volumes, timestamps);
    const volMA = volumeMA(volumes, VOLUME_MA_PERIOD);
    const cvdArr = cvd(opens, closes, volumes);

    return candles.map((c, i) => ({
        ...c,
        ema9: ema9[i],
        ema21: ema21[i],
        rsi: rsiArr[i],
        atr: atrArr[i],
        vwap: vwapArr[i],
        volMA: volMA[i],
        cvd: cvdArr[i],
    }));
}

module.exports = { ema, rsi, atr, vwap, volumeMA, cvd, computeAll };
