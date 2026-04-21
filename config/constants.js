// ============================================================
// config/constants.js — semua parameter bot di sini
// ============================================================

module.exports = {

    // --- INDIKATOR ---
    EMA_FAST: 9,
    EMA_SLOW: 21,
    RSI_PERIOD: 7,
    ATR_PERIOD: 14,
    VOLUME_MA_PERIOD: 20,
    WARMUP_CANDLES: 30,       // candle minimum sebelum mulai hitung

    // --- MODEL ---
    LEARNING_RATE: 0.01,
    EPOCHS: 3000,
    N_FEATURES: 6,            // jumlah feature vector

    // --- BACKTEST ---
    INITIAL_BALANCE: 1000,    // USD simulasi
    BET_SIZE: 0.02,           // 2% per trade
    WIN_MULTIPLIER: 1.92,     // Polymarket YES payout rata2
    LOSS_MULTIPLIER: 0,       // kalah = 0
    THRESHOLD_UP: 0.60,       // predict UP kalau P >= 0.60
    THRESHOLD_DOWN: 0.40,     // predict DOWN kalau P <= 0.40
    PREDICT_HORIZON: 5,       // candle ke depan untuk label (5 menit)
    TRADE_MODE: "continuous", // "continuous" (tiap menit) atau "fixed" (tiap 5 menit)

    // --- DATA ---
    BINANCE_SYMBOL: "BTCUSDT",
    BINANCE_INTERVAL: "1m",
    BINANCE_LIMIT: 1000,      // max candles per request
    DATA_PATH: "./data/btc.json",
    WEIGHTS_PATH: "./data/weights.json",
    CSV_PATH: "./data/btc_1m.csv",

    // --- LIVE ---
    WS_RECONNECT_DELAY: 5000, // ms delay sebelum reconnect WebSocket
    SIGNAL_MIN_CONFIDENCE: 0.60,

    // --- LOG ---
    LOG_BACKTEST: "./logs/backtest.log",
    LOG_TRADES: "./logs/trades.log",
    LOG_EQUITY: "./logs/equity.csv",

    // --- SECONDARY SIGNALS (Confirmation Gate saat HOLD) ---
    FUTURES_BASE: "https://fapi.binance.com",
    SECONDARY_THRESHOLD: 4,       // min skor absolut untuk override HOLD
    OI_DELTA_THRESHOLD: 0.005,    // 0.5% perubahan OI = signifikan
    FUNDING_EXTREME: 0.0001,      // funding rate ±0.01% = crowded trade
    LIQD_SPIKE_WINDOW: 5,         // window liquidasi dalam menit
    OB_IMBALANCE_THRESHOLD: 0.20, // 20% imbalance bid vs ask = signifikan
};
