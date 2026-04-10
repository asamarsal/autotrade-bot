// ============================================================
// src/secondary-signals.js — Secondary Confirmation Gate
//
// HANYA aktif saat model utama output HOLD (P antara 0.40-0.60)
// Mengambil sinyal dari Binance Futures (public, no API key)
//
// Scoring: setiap sinyal = +1 (bullish) / -1 (bearish) / 0 (netral)
// Total >= +THRESHOLD → UP | Total <= -THRESHOLD → DOWN | else → HOLD
// ============================================================

const https = require("https");
const { logger, round } = require("./utils");
const C = require("../config/constants");

// ============================================================
// HTTP helper (promise-based, no dependency)
// ============================================================
function httpGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`JSON parse error: ${e.message}`));
                }
            });
        }).on("error", reject);
    });
}

// ============================================================
// 1. Open Interest Delta
// edge: apakah uang besar sedang masuk (bullish) atau keluar (bearish)
// Endpoint: GET /fapi/v1/openInterest
// ============================================================
class OITracker {
    constructor() {
        this.previousOI = null;
    }

    async fetch(symbol = C.BINANCE_SYMBOL) {
        try {
            const url = `${C.FUTURES_BASE}/fapi/v1/openInterest?symbol=${symbol}`;
            const data = await httpGet(url);
            return parseFloat(data.openInterest);
        } catch (err) {
            logger.debug(`OI fetch error: ${err.message}`);
            return null;
        }
    }

    async getSignal(symbol) {
        const currentOI = await this.fetch(symbol);
        if (currentOI === null || this.previousOI === null) {
            this.previousOI = currentOI;
            return { score: 0, reason: "OI: data belum cukup", oi: currentOI };
        }

        const delta = (currentOI - this.previousOI) / this.previousOI;
        this.previousOI = currentOI;

        let score = 0;
        if (delta > C.OI_DELTA_THRESHOLD) score = 1;       // OI naik → trend kuat
        else if (delta < -C.OI_DELTA_THRESHOLD) score = -1; // OI turun → trend melemah

        return {
            score,
            reason: `OI Delta: ${round(delta * 100, 3)}% (${score > 0 ? "bullish" : score < 0 ? "bearish" : "netral"})`,
            delta,
            currentOI,
        };
    }
}

// ============================================================
// 2. Funding Rate
// edge: funding rate positif tinggi = long terlalu crowded → reversal risk
// Endpoint: GET /fapi/v1/fundingRate
// ============================================================
async function getFundingSignal(symbol = C.BINANCE_SYMBOL) {
    try {
        const url = `${C.FUTURES_BASE}/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
        const data = await httpGet(url);
        const rate = parseFloat(data[0]?.fundingRate ?? 0);

        let score = 0;
        if (rate < -C.FUNDING_EXTREME) {
            // Funding negatif = short crowded → squeeze bullish
            score = 1;
        } else if (rate > C.FUNDING_EXTREME) {
            // Funding sangat positif = long crowded → tekanan jual / squeeze bearish
            score = -1;
        }

        return {
            score,
            reason: `Funding Rate: ${round(rate * 100, 4)}% (${score > 0 ? "short squeeze risk → bullish" : score < 0 ? "long crowded → bearish" : "netral"})`,
            rate,
        };
    } catch (err) {
        logger.debug(`Funding fetch error: ${err.message}`);
        return { score: 0, reason: "Funding: error fetch", rate: null };
    }
}

// ============================================================
// 3. Liquidation Spike
// edge: banyak liquidasi SHORT = bullish pump; banyak likuidasi LONG = dump
// Data dikumpulkan dari WebSocket forceOrder stream di live-bot.js
// Di sini hanya menganalisis buffer yang dikirim
// ============================================================
function getLiquidationSignal(liquidationBuffer = []) {
    // Buffer: array of { side: "SHORT"|"LONG", qty, timestamp }
    const now = Date.now();
    const windowMs = C.LIQD_SPIKE_WINDOW * 60 * 1000; // default 5 menit

    // Hanya hitung liquidasi dalam window terakhir
    const recent = liquidationBuffer.filter((l) => now - l.timestamp < windowMs);

    const shortLiqs = recent.filter((l) => l.side === "SHORT").reduce((a, l) => a + l.qty, 0);
    const longLiqs = recent.filter((l) => l.side === "LONG").reduce((a, l) => a + l.qty, 0);
    const total = shortLiqs + longLiqs;

    let score = 0;
    if (total > 0) {
        const shortRatio = shortLiqs / total;
        if (shortRatio > 0.65) score = 1;       // lebih banyak short dilikuidasi → bullish
        else if (shortRatio < 0.35) score = -1; // lebih banyak long dilikuidasi → bearish
    }

    return {
        score,
        reason: `Liquidation: SHORT=${round(shortLiqs, 2)} LONG=${round(longLiqs, 2)} (${score > 0 ? "short squeeze" : score < 0 ? "long dump" : "netral"})`,
        shortLiqs,
        longLiqs,
        count: recent.length,
    };
}

// ============================================================
// 4. CVD Signal (dari buffer candle)
// edge: real buying vs selling pressure (sudah ada di indicators.js)
// ============================================================
function getCVDSignal(candles) {
    if (!candles || candles.length < 6) {
        return { score: 0, reason: "CVD: buffer belum cukup" };
    }

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 6]; // 5 candle lalu

    if (last.cvd === undefined || prev.cvd === undefined) {
        return { score: 0, reason: "CVD: data tidak tersedia" };
    }

    const cvdChange = last.cvd - prev.cvd;
    const score = cvdChange > 0 ? 1 : -1;

    return {
        score,
        reason: `CVD: ${cvdChange > 0 ? "naik" : "turun"} (${round(cvdChange, 0)}) → ${score > 0 ? "buy pressure" : "sell pressure"}`,
        cvdChange,
        current: last.cvd,
        previous: prev.cvd,
    };
}

// ============================================================
// 5. Order Book Imbalance
// edge: microstructure — apakah bid atau ask yang mendominasi
// Endpoint: GET /fapi/v1/depth
// Imbalance = (sumBid - sumAsk) / (sumBid + sumAsk)
// ============================================================
async function getOrderBookSignal(symbol = C.BINANCE_SYMBOL) {
    try {
        const url = `${C.FUTURES_BASE}/fapi/v1/depth?symbol=${symbol}&limit=20`;
        const data = await httpGet(url);

        const sumBid = data.bids.reduce((acc, [, qty]) => acc + parseFloat(qty), 0);
        const sumAsk = data.asks.reduce((acc, [, qty]) => acc + parseFloat(qty), 0);
        const total = sumBid + sumAsk;

        if (total === 0) return { score: 0, reason: "OB: tidak ada data" };

        const imbalance = (sumBid - sumAsk) / total; // -1 ~ +1

        let score = 0;
        if (imbalance > C.OB_IMBALANCE_THRESHOLD) score = 1;       // bid dominan → bullish pressure
        else if (imbalance < -C.OB_IMBALANCE_THRESHOLD) score = -1; // ask dominan → bearish pressure

        return {
            score,
            reason: `OB Imbalance: ${round(imbalance, 3)} (${score > 0 ? "bid dominan → bullish" : score < 0 ? "ask dominan → bearish" : "netral"})`,
            imbalance,
            sumBid: round(sumBid, 2),
            sumAsk: round(sumAsk, 2),
        };
    } catch (err) {
        logger.debug(`OrderBook fetch error: ${err.message}`);
        return { score: 0, reason: "OB: error fetch", imbalance: null };
    }
}

// ============================================================
// Main: evaluate semua secondary signals
// Returns { signal, totalScore, breakdown }
// ============================================================
class SecondarySignals {
    constructor() {
        this.oiTracker = new OITracker();
        this.liquidationBuffer = []; // diisi dari live-bot.js via pushLiquidation()
    }

    // Dipanggil dari live-bot.js setiap ada liquidation event dari WS
    pushLiquidation(side, qty) {
        this.liquidationBuffer.push({ side, qty: parseFloat(qty), timestamp: Date.now() });
        // Jaga buffer max 500 entries
        if (this.liquidationBuffer.length > 500) {
            this.liquidationBuffer.shift();
        }
    }

    async evaluate(candles, symbol = C.BINANCE_SYMBOL) {
        logger.debug("🔍 Running secondary signal evaluation...");

        // Fetch semua signal secara paralel (kecuali CVD dan Liquidation yang local)
        const [oiResult, fundingResult, obResult] = await Promise.all([
            this.oiTracker.getSignal(symbol),
            getFundingSignal(symbol),
            getOrderBookSignal(symbol),
        ]);

        const liqdResult = getLiquidationSignal(this.liquidationBuffer);
        const cvdResult = getCVDSignal(candles);

        const signals = [oiResult, fundingResult, liqdResult, cvdResult, obResult];
        const totalScore = signals.reduce((sum, s) => sum + s.score, 0);

        let signal = "HOLD";
        if (totalScore >= C.SECONDARY_THRESHOLD) signal = "UP";
        else if (totalScore <= -C.SECONDARY_THRESHOLD) signal = "DOWN";

        const breakdown = {
            "OI Delta": { score: oiResult.score, detail: oiResult.reason },
            "Funding Rate": { score: fundingResult.score, detail: fundingResult.reason },
            "Liquidation": { score: liqdResult.score, detail: liqdResult.reason },
            "CVD": { score: cvdResult.score, detail: cvdResult.reason },
            "OB Imbalance": { score: obResult.score, detail: obResult.reason },
        };

        // Log breakdown
        const scoreStr = signals.map((s) => (s.score > 0 ? `+${s.score}` : `${s.score}`)).join(" | ");
        logger.info(`🔬 Secondary Gate [${scoreStr}] = ${totalScore} → ${signal}`);
        Object.entries(breakdown).forEach(([name, v]) => {
            logger.debug(`   ${name.padEnd(15)} ${v.score > 0 ? "🟢" : v.score < 0 ? "🔴" : "⚪"} ${v.detail}`);
        });

        return { signal, totalScore, breakdown, wasAmbiguous: true };
    }
}

module.exports = SecondarySignals;
