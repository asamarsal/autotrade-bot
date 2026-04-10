# 🤖 BTC Polymarket Trading Bot

Bot trading otomatis untuk Polymarket menggunakan data real-time BTC dari Binance, dengan backtest engine, auto-calibration weight via logistic regression, dan **Secondary Confirmation Gate** (OI Delta, Funding Rate, Liquidation, CVD, Order Book Imbalance).

---

## 📁 Struktur Folder

```
/bot
 ├── data/
 │    ├── btc_1m.csv       ← candle historis (CSV)
 │    ├── btc.json         ← candle historis (JSON)
 │    └── weights.json     ← model weights (auto-generated)
 ├── src/
 │    ├── indicators.js        ← EMA, RSI, ATR, VWAP, CVD
 │    ├── features.js          ← feature engineering
 │    ├── model.js             ← logistic regression + gradient descent
 │    ├── backtest.js          ← backtest engine + walk-forward
 │    ├── scorer.js            ← primary scoring + secondary gate
 │    ├── secondary-signals.js ← OI, Funding, Liquidation, OB Imbalance
 │    ├── executor.js          ← Polymarket order execution
 │    └── utils.js             ← helper functions
 ├── scripts/
 │    ├── fetch-data.js    ← ambil data dari Binance
 │    ├── train.js         ← train model
 │    ├── run-backtest.js  ← jalankan backtest
 │    └── live-bot.js      ← live trading via WebSocket
 ├── config/
 │    ├── .env             ← API keys (jangan di-commit!)
 │    └── constants.js     ← semua parameter bot
 ├── logs/
 │    ├── backtest.log     ← detail trade backtest
 │    ├── trades.log       ← log live trading
 │    └── equity.csv       ← equity curve
 └── package.json
```

---

## ⚙️ Prerequisites

- **Node.js** v18+ → [nodejs.org](https://nodejs.org)
- Koneksi internet (untuk fetch data Binance)
- (Opsional untuk live trading) Wallet MetaMask dengan saldo USDC.e di jaringan Polygon

---

## 🚀 How to Install

### 1. Clone / masuk ke folder proyek
```bash
cd polymarket-bot
```

### 2. Install dependencies
```bash
npm install
```

### 3. Salin template environment
```bash
cp config/.env config/.env.local
```
*(Atau edit langsung file `config/.env`)*

---

## 🔑 API Keys — Isi Dimana & Dari Mana

Semua key diletakkan di file **`config/.env`**:

```env
# ============================================================
# 1. BINANCE API (opsional untuk data fetch & live stream)
# ============================================================
BINANCE_API_KEY=isi_jika_punya
BINANCE_SECRET=isi_jika_punya

# ============================================================
# 2. POLYMARKET (wajib untuk eksekusi order nyata)
# ============================================================
POLYMARKET_API_KEY=hasil_dari_script_setup_di_bawah
POLYMARKET_WALLET_ADDRESS=0xAlamat_MetaMask_Kamu
POLYMARKET_PRIVATE_KEY=0xPrivate_Key_MetaMask_Kamu

# ============================================================
# 3. MODE BOT
# ============================================================
BOT_MODE=paper        # "paper" = simulasi | "live" = order nyata

STARTING_BALANCE=1000 # modal simulasi (USD)

LOG_LEVEL=info        # "debug" | "info" | "error"
```

---

### 🔑 Detail Cara Mendapatkan Setiap Key

#### A. Binance API Key (OPSIONAL)
> Fetch data historis dan WebSocket price stream adalah **public** — tidak butuh API key.
> API key hanya diperlukan jika terkena rate limit yang sangat banyak.

1. Daftar / login di [binance.com](https://www.binance.com)
2. Profil → **API Management** → **Create API**
3. Izinkan hanya **"Enable Reading"** (tidak perlu trading)
4. Copy `API Key` dan `Secret Key` → paste ke `.env`

---

#### B. Polymarket API Key (WAJIB untuk live trading)

> ⚠️ **Polymarket tidak punya sandbox/testnet.** Gunakan **paper mode** untuk testing.

**Step 1 — Siapkan wallet Polygon:**
1. Install [MetaMask](https://metamask.io) → tambah jaringan **Polygon Mainnet**
2. Beli sedikit **USDC.e** di Polygon (min ~$5 untuk test)
3. Beli sedikit **POL/MATIC** untuk gas fee (~$1 cukup)
4. Login di [polymarket.com](https://polymarket.com) → connect MetaMask

**Step 2 — Ambil Private Key dari MetaMask:**
MetaMask → menu titik tiga → Account Details → **Export Private Key**
> ⚠️ Jangan pernah share private key ini ke siapapun!

**Step 3 — Generate API Key Polymarket:**
Jalankan sekali saja:
```bash
npm install @polymarket/clob-client ethers
node -e "
const { ClobClient } = require('@polymarket/clob-client');
const { Wallet } = require('ethers');
require('dotenv').config({ path: './config/.env' });
(async () => {
  const signer = new Wallet(process.env.POLYMARKET_PRIVATE_KEY);
  const client = new ClobClient('https://clob.polymarket.com', 137, signer);
  const creds = await client.createOrDeriveApiKey();
  console.log('API Key:', creds.key);
  console.log('Paste ini ke POLYMARKET_API_KEY di .env');
})();
"
```
Copy hasilnya → paste ke `POLYMARKET_API_KEY` di `.env`.

---

#### C. Cari Polymarket Market ID untuk BTC

Ubah `live-bot.js` bagian ini dengan market yang ingin di-trade:
```js
const POLYMARKET_MARKET = {
  conditionId: "0x...",   // ambil dari polymarket.com/event/...
  tokenIdYes: "123...",
  tokenIdNo: "456...",
};
```

Cara cari conditionId:
```bash
# List market aktif BTC di Polymarket
curl "https://clob.polymarket.com/markets?active=true" | grep -i bitcoin
```

---

## 🏃 How to Use

### Step 1 — Fetch Data Historis
```bash
npm run fetch
# Default: 5000 candle terakhir BTC 1m
# Custom: node scripts/fetch-data.js 10000
```

### Step 2 — Train Model
```bash
npm run train
# Model logistic regression belajar bobot optimal
# Hasil disimpan → data/weights.json
```

### Step 3 — Backtest
```bash
npm run backtest
# Simulasi di data historis
# Output: winrate, equity curve, walk-forward validation
```

### Step 4 — Live Bot (Paper Mode, default)
```bash
npm run live
# BOT_MODE=paper → tidak ada order nyata
# Bot connect ke 2 WebSocket:
#   1. btcusdt@kline_1m → data harga
#   2. btcusdt@forceOrder → data liquidasi (untuk secondary gate)
```

### Jalankan semua sekaligus
```bash
npm run full
# fetch → train → backtest (tanpa live)
```

---

## 🧠 Cara Kerja — Decision Flow

```
Candle 1m masuk
    ↓
[Primary Model: Logistic Regression]
P(UP) ≥ 0.60 → 🟢 BUY YES
P(UP) ≤ 0.40 → 🔴 BUY NO
P antara → HOLD
    ↓ (hanya jika HOLD)
[Secondary Confirmation Gate]
Fetch: OI Delta | Funding Rate | Liquidation | CVD | OB Imbalance
Setiap sinyal: +1 (bullish) / -1 (bearish) / 0 (netral)
    ↓
Total ≥ +3 → 🟢 UP (override)
Total ≤ -3 → 🔴 DOWN (override)
else      → ⚪ HOLD (tidak pasang taruhan)
```

### Feature Vector (6 dimensi — Primary Model)
| Index | Feature       | Logika                                 |
| ----- | ------------- | -------------------------------------- |
| 0     | EMA Signal    | EMA9 > EMA21 → bullish                 |
| 1     | RSI Signal    | <30 oversold (+1), >70 overbought (-1) |
| 2     | VWAP Signal   | Price > VWAP → bullish                 |
| 3     | Volume Signal | Vol > 1.5x avg → spike                 |
| 4     | ATR Signal    | ATR > normal → volatil                 |
| 5     | CVD Signal    | CVD naik vs 5 candle lalu              |

### Secondary Gate Signals
| Signal            | Sumber Data                             | Edge              |
| ----------------- | --------------------------------------- | ----------------- |
| OI Delta          | Binance Futures `/fapi/v1/openInterest` | Trend strength    |
| Funding Rate      | Binance Futures `/fapi/v1/fundingRate`  | Crowded trade     |
| Liquidation Spike | WebSocket `btcusdt@forceOrder`          | Reversal cepat    |
| CVD               | Candle buffer (lokal)                   | Buy/sell pressure |
| OB Imbalance      | Binance Futures `/fapi/v1/depth`        | Microstructure    |

> Semua secondary data adalah **public API** — tidak butuh API key.

---

## ⚙️ Konfigurasi (`config/constants.js`)

| Parameter              | Default | Keterangan                             |
| ---------------------- | ------- | -------------------------------------- |
| EMA_FAST               | 9       | EMA periode cepat                      |
| EMA_SLOW               | 21      | EMA periode lambat                     |
| RSI_PERIOD             | 7       | RSI periode                            |
| EPOCHS                 | 1000    | Iterasi training                       |
| LEARNING_RATE          | 0.01    | Step size gradient descent             |
| THRESHOLD_UP           | 0.60    | Min confidence untuk trade UP          |
| THRESHOLD_DOWN         | 0.40    | Max confidence untuk trade DOWN        |
| BET_SIZE               | 0.02    | Max 2% balance per trade               |
| PREDICT_HORIZON        | 5       | Prediksi 5 candle ke depan (5 menit)   |
| SECONDARY_THRESHOLD    | 3       | Min skor secondary untuk override HOLD |
| OI_DELTA_THRESHOLD     | 0.005   | 0.5% OI change = signifikan            |
| FUNDING_EXTREME        | 0.0001  | ±0.01% = crowded trade                 |
| LIQD_SPIKE_WINDOW      | 5       | Window liquidasi dalam menit           |
| OB_IMBALANCE_THRESHOLD | 0.20    | 20% imbalance = signifikan             |

---

## 📊 Interpretasi Output Backtest

```
Win Rate     > 55% = bagus untuk binary market
Coverage     ~20-40% = tidak overtrade
Max Drawdown < 20% = risk terkontrol
Profit Factor > 1.5 = strategi profitable
Sharpe       > 1.0 = risk-adjusted return baik
```

---

## ⚠️ Penting

1. **Ini bukan financial advice.** Gunakan dengan modal yang siap hilang.
2. **Backtest ≠ future results.** Selalu validasi dengan walk-forward.
3. Default `BOT_MODE=paper` — aman untuk testing, tidak ada order nyata.
4. Jangan commit file `.env` ke git! (sudah di-exclude di `.gitignore`)
5. Untuk live trading nyata, install CLOB client:
   ```bash
   npm install @polymarket/clob-client ethers
   ```

---

## 🔧 Troubleshooting

| Error                   | Solusi                                           |
| ----------------------- | ------------------------------------------------ |
| "Data tidak ditemukan"  | Jalankan `npm run fetch` dulu                    |
| "Model tidak ditemukan" | Jalankan `npm run train` dulu                    |
| WebSocket disconnect    | Bot auto-reconnect dalam 5 detik                 |
| Training lambat         | Kurangi EPOCHS di constants.js (misal 300)       |
| Secondary gate timeout  | Cek koneksi internet / Binance Futures aksesibel |
