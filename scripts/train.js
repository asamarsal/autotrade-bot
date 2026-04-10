// ============================================================
// scripts/train.js — train model dari data historis
// Jalankan: node scripts/train.js
// ============================================================

require("dotenv").config({ path: "./config/.env" });

const { loadJSON, logger, round } = require("../src/utils");
const { computeAll } = require("../src/indicators");
const { buildFeatures, trainTestSplit } = require("../src/features");
const LogisticModel = require("../src/model");
const C = require("../config/constants");

async function main() {
  logger.info("=== TRAINING DIMULAI ===");

  // 1. Load data
  logger.info(`Load data dari ${C.DATA_PATH}...`);
  let candles;
  try {
    candles = loadJSON(C.DATA_PATH);
  } catch (err) {
    logger.error("Data tidak ditemukan. Jalankan dulu: node scripts/fetch-data.js");
    process.exit(1);
  }
  logger.info(`Total candle: ${candles.length}`);

  // 2. Hitung indikator
  logger.info("Menghitung indikator...");
  const withIndicators = computeAll(candles, {
    EMA_FAST: C.EMA_FAST,
    EMA_SLOW: C.EMA_SLOW,
    RSI_PERIOD: C.RSI_PERIOD,
    ATR_PERIOD: C.ATR_PERIOD,
    VOLUME_MA_PERIOD: C.VOLUME_MA_PERIOD,
  });

  // 3. Build features
  logger.info("Build feature vectors...");
  const { features, labels } = buildFeatures(withIndicators, C.PREDICT_HORIZON);
  logger.info(`Feature vectors: ${features.length}, Fitur per vector: ${features[0].length}`);

  // Distribusi label
  const upCount = labels.filter((l) => l === 1).length;
  const downCount = labels.filter((l) => l === 0).length;
  logger.info(`Label distribusi: UP=${upCount} (${round(upCount / labels.length * 100, 1)}%), DOWN=${downCount} (${round(downCount / labels.length * 100, 1)}%)`);

  // 4. Train/test split
  const { trainX, trainY, testX, testY } = trainTestSplit(features, labels, 0.8);
  logger.info(`Train: ${trainX.length} | Test: ${testX.length}`);

  // 5. Inisialisasi & train model
  const model = new LogisticModel(C.N_FEATURES);
  model.train(trainX, trainY, C.EPOCHS, C.LEARNING_RATE);

  // 6. Evaluasi di test set
  logger.info("\n=== EVALUASI TEST SET ===");
  const evalResult = model.evaluate(testX, testY);
  logger.info("Hasil evaluasi:", evalResult);

  console.log("\n┌─────────────────────────────┐");
  console.log("│      HASIL TRAINING          │");
  console.log("├─────────────────────────────┤");
  console.log(`│ Akurasi      : ${String(evalResult.accuracy * 100).padEnd(6)}%      │`);
  console.log(`│ Total trades : ${String(evalResult.tradeCount).padEnd(12)}  │`);
  console.log(`│ Coverage     : ${String(evalResult.coverage * 100).padEnd(6)}%      │`);
  console.log(`│ Precision    : ${String(evalResult.precision * 100).padEnd(6)}%      │`);
  console.log(`│ Recall       : ${String(evalResult.recall * 100).padEnd(6)}%      │`);
  console.log(`│ F1 Score     : ${String(evalResult.f1).padEnd(13)} │`);
  console.log("└─────────────────────────────┘\n");

  // 7. Simpan model
  model.save(C.WEIGHTS_PATH);
  logger.info(`✅ Model disimpan → ${C.WEIGHTS_PATH}`);

  // 8. Cek overfitting
  const trainEval = model.evaluate(trainX, trainY);
  const trainAcc = trainEval.accuracy;
  const testAcc = evalResult.accuracy;
  const gap = trainAcc - testAcc;

  if (gap > 0.1) {
    logger.info(`⚠️  WARNING: Train acc (${trainAcc}) jauh lebih tinggi dari Test acc (${testAcc}). Kemungkinan overfit.`);
  } else {
    logger.info(`✅ Train/Test gap kecil (${round(gap, 4)}). Model generalize dengan baik.`);
  }
}

main().catch((err) => {
  logger.error("Training gagal:", err.message);
  console.error(err);
  process.exit(1);
});
