// ============================================================
// src/indicators.js — kalkulasi indikator teknikal
// Semua fungsi murni: input array → output array
// ============================================================

const { mean } = require("./utils");

// --- EMA (Exponential Moving Average) ---
function ema(closes, period) {
    if (closes.length < period) return closes.map(() => null);
    const k = 2 / (period + 1);
    const result = new Array(closes.length).fill(null);

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

    const tr = closes.map((c, i) => {
        if (i === 0) return highs[i] - lows[i];
        const prevClose = closes[i - 1];
        return Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - prevClose),
            Math.abs(lows[i] - prevClose)
        );
    });

    let atrVal = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
    result[period] = atrVal;

    for (let i = period + 1; i < closes.length; i++) {
        atrVal = (atrVal * (period - 1) + tr[i]) / period;
        result[i] = atrVal;
    }
    return result;
}

// --- VWAP (Volume Weighted Average Price) ---
function vwap(highs, lows, closes, volumes, timestamps) {
    const result = new Array(closes.length).fill(null);
    let cumTPV = 0;
    let cumVol = 0;
    let currentDay = null;

    for (let i = 0; i < closes.length; i++) {
        const day = new Date(timestamps[i]).toDateString();

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
function cvd(opens, closes, volumes) {
    let cumDelta = 0;
    return closes.map((close, i) => {
        const delta = close >= opens[i] ? volumes[i] : -volumes[i];
        cumDelta += delta;
        return cumDelta;
    });
}

// --- MACD (Moving Average Convergence Divergence) ---
// Returns { macdLine, signalLine, histogram }
function macd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const n = closes.length;
    const macdLine = new Array(n).fill(null);
    const signalLine = new Array(n).fill(null);
    const histogram = new Array(n).fill(null);

    const emaFast = ema(closes, fastPeriod);
    const emaSlow = ema(closes, slowPeriod);

    // MACD line = EMA_fast - EMA_slow (hanya valid mulai slowPeriod-1)
    const macdValues = [];
    const macdStartIdx = slowPeriod - 1;
    for (let i = 0; i < n; i++) {
        if (emaFast[i] !== null && emaSlow[i] !== null) {
            macdLine[i] = emaFast[i] - emaSlow[i];
            macdValues.push(macdLine[i]);
        } else {
            macdValues.push(null);
        }
    }

    // Signal line = EMA(macdLine, signalPeriod)
    // Ambil nilai macd yang valid untuk dihitung EMA-nya
    const validMacd = macdValues.filter((v) => v !== null);
    const signalEma = ema(validMacd, signalPeriod);

    let signalIdx = 0;
    for (let i = 0; i < n; i++) {
        if (macdLine[i] !== null) {
            const sVal = signalEma[signalIdx];
            if (sVal !== null) {
                signalLine[i] = sVal;
                histogram[i] = macdLine[i] - sVal;
            }
            signalIdx++;
        }
    }

    return { macdLine, signalLine, histogram };
}

// --- Bollinger Bands ---
// Returns { upper, middle, lower }
function bollingerBands(closes, period = 20, stdDev = 2) {
    const n = closes.length;
    const upper = new Array(n).fill(null);
    const middle = new Array(n).fill(null);
    const lower = new Array(n).fill(null);

    for (let i = period - 1; i < n; i++) {
        const slice = closes.slice(i - period + 1, i + 1);
        const avg = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((sum, v) => sum + (v - avg) ** 2, 0) / period;
        const sd = Math.sqrt(variance);

        middle[i] = avg;
        upper[i] = avg + stdDev * sd;
        lower[i] = avg - stdDev * sd;
    }

    return { upper, middle, lower };
}

// --- Stochastic Oscillator (%K, %D) ---
// Returns { k, d }
function stochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
    const n = closes.length;
    const kArr = new Array(n).fill(null);
    const dArr = new Array(n).fill(null);

    for (let i = kPeriod - 1; i < n; i++) {
        const highSlice = highs.slice(i - kPeriod + 1, i + 1);
        const lowSlice = lows.slice(i - kPeriod + 1, i + 1);
        const highMax = Math.max(...highSlice);
        const lowMin = Math.min(...lowSlice);
        const range = highMax - lowMin;
        kArr[i] = range === 0 ? 50 : ((closes[i] - lowMin) / range) * 100;
    }

    // %D = SMA(kArr, dPeriod)
    for (let i = kPeriod + dPeriod - 2; i < n; i++) {
        const slice = kArr.slice(i - dPeriod + 1, i + 1).filter((v) => v !== null);
        if (slice.length === dPeriod) {
            dArr[i] = slice.reduce((a, b) => a + b, 0) / dPeriod;
        }
    }

    return { k: kArr, d: dArr };
}

// --- Compute all indicators on candle array ---
function computeAll(candles, cfg = {}) {
    const {
        EMA_FAST = 9,
        EMA_SLOW = 21,
        RSI_PERIOD = 7,
        ATR_PERIOD = 14,
        VOLUME_MA_PERIOD = 20,
        MACD_FAST = 12,
        MACD_SLOW = 26,
        MACD_SIGNAL = 9,
        BB_PERIOD = 20,
        BB_STDDEV = 2,
        STOCH_K = 14,
        STOCH_D = 3,
    } = cfg;

    const opens = candles.map((c) => c.open);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);
    const timestamps = candles.map((c) => c.timestamp);

    const ema9Arr = ema(closes, EMA_FAST);
    const ema21Arr = ema(closes, EMA_SLOW);
    const rsiArr = rsi(closes, RSI_PERIOD);
    const atrArr = atr(highs, lows, closes, ATR_PERIOD);
    const vwapArr = vwap(highs, lows, closes, volumes, timestamps);
    const volMAArr = volumeMA(volumes, VOLUME_MA_PERIOD);
    const cvdArr = cvd(opens, closes, volumes);

    const { macdLine, signalLine, histogram } = macd(closes, MACD_FAST, MACD_SLOW, MACD_SIGNAL);
    const { upper: bbUpper, middle: bbMiddle, lower: bbLower } = bollingerBands(closes, BB_PERIOD, BB_STDDEV);
    const { k: stochK, d: stochD } = stochastic(highs, lows, closes, STOCH_K, STOCH_D);

    return candles.map((c, i) => ({
        ...c,
        ema9: ema9Arr[i],
        ema21: ema21Arr[i],
        rsi: rsiArr[i],
        atr: atrArr[i],
        vwap: vwapArr[i],
        volMA: volMAArr[i],
        cvd: cvdArr[i],
        macd: macdLine[i],
        macdSignal: signalLine[i],
        macdHist: histogram[i],
        bbUpper: bbUpper[i],
        bbMiddle: bbMiddle[i],
        bbLower: bbLower[i],
        stochK: stochK[i],
        stochD: stochD[i],
    }));
}

module.exports = {
    ema, rsi, atr, vwap, volumeMA, cvd,
    macd, bollingerBands, stochastic,
    computeAll,
};