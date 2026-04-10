// ============================================================
// src/model.js — Logistic Regression dengan Gradient Descent
// Auto-calibration: weights belajar sendiri dari data
// ============================================================

const { saveJSON, loadJSON, logger, round } = require("./utils");
const C = require("../config/constants");

class LogisticModel {
    constructor(nFeatures = C.N_FEATURES) {
        this.nFeatures = nFeatures;
        // inisialisasi weights kecil random (bukan 0 — hindari dead zone)
        this.weights = Array.from({ length: nFeatures }, () => (Math.random() - 0.5) * 0.1);
        this.bias = 0;
        this.trainHistory = []; // loss per epoch untuk monitoring
    }

    // --- Sigmoid activation ---
    sigmoid(z) {
        // clamp untuk hindari overflow
        if (z > 500) return 1;
        if (z < -500) return 0;
        return 1 / (1 + Math.exp(-z));
    }

    // --- Forward pass: prediksi probabilitas UP ---
    predict(x) {
        let z = this.bias;
        for (let i = 0; i < x.length; i++) {
            z += x[i] * this.weights[i];
        }
        return this.sigmoid(z);
    }

    // --- Binary Cross-Entropy Loss ---
    loss(X, Y) {
        let total = 0;
        for (let i = 0; i < X.length; i++) {
            const p = this.predict(X[i]);
            const eps = 1e-9; // hindari log(0)
            total += -(Y[i] * Math.log(p + eps) + (1 - Y[i]) * Math.log(1 - p + eps));
        }
        return total / X.length;
    }

    // --- Training: Gradient Descent (batch) ---
    train(X, Y, epochs = C.EPOCHS, lr = C.LEARNING_RATE, verbose = true) {
        logger.info(`Mulai training: ${X.length} samples, ${epochs} epochs, lr=${lr}`);
        const startTime = Date.now();

        for (let e = 0; e < epochs; e++) {
            // Gradient accumulator
            const gradW = new Array(this.nFeatures).fill(0);
            let gradB = 0;

            for (let i = 0; i < X.length; i++) {
                const pred = this.predict(X[i]);
                const error = pred - Y[i]; // dL/dz

                for (let j = 0; j < this.nFeatures; j++) {
                    gradW[j] += error * X[i][j];
                }
                gradB += error;
            }

            // Update weights (average gradient)
            for (let j = 0; j < this.nFeatures; j++) {
                this.weights[j] -= (lr * gradW[j]) / X.length;
            }
            this.bias -= (lr * gradB) / X.length;

            // Log loss setiap 100 epoch
            if (e % 100 === 0) {
                const l = this.loss(X, Y);
                this.trainHistory.push({ epoch: e, loss: round(l, 6) });
                if (verbose) {
                    logger.info(`Epoch ${e}/${epochs} | Loss: ${round(l, 6)} | Weights: [${this.weights.map(w => round(w, 4)).join(", ")}]`);
                }
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.info(`Training selesai dalam ${elapsed}s`);
        this.printWeightSummary();
    }

    // --- Evaluate akurasi di test set ---
    evaluate(X, Y, thresholdUp = C.THRESHOLD_UP, thresholdDown = C.THRESHOLD_DOWN) {
        let correct = 0;
        let tradeCount = 0;
        let truePos = 0, falsePos = 0, trueNeg = 0, falseNeg = 0;

        for (let i = 0; i < X.length; i++) {
            const p = this.predict(X[i]);
            if (p >= thresholdUp || p <= thresholdDown) {
                tradeCount++;
                const predictedUp = p >= thresholdUp;
                const actualUp = Y[i] === 1;

                if (predictedUp === actualUp) {
                    correct++;
                    if (predictedUp) truePos++;
                    else trueNeg++;
                } else {
                    if (predictedUp) falsePos++;
                    else falseNeg++;
                }
            }
        }

        const precision = truePos / (truePos + falsePos || 1);
        const recall = truePos / (truePos + falseNeg || 1);
        const f1 = 2 * (precision * recall) / (precision + recall || 1);

        return {
            accuracy: round(correct / (tradeCount || 1), 4),
            tradeCount,
            coverage: round(tradeCount / X.length, 4), // % candle yang menghasilkan signal
            precision: round(precision, 4),
            recall: round(recall, 4),
            f1: round(f1, 4),
        };
    }

    // --- Simpan model ke file ---
    save(filePath = C.WEIGHTS_PATH) {
        const data = {
            weights: this.weights,
            bias: this.bias,
            nFeatures: this.nFeatures,
            trainHistory: this.trainHistory,
            savedAt: new Date().toISOString(),
        };
        saveJSON(filePath, data);
        logger.info(`Model disimpan → ${filePath}`);
    }

    // --- Load model dari file ---
    load(filePath = C.WEIGHTS_PATH) {
        const data = loadJSON(filePath);
        this.weights = data.weights;
        this.bias = data.bias;
        this.nFeatures = data.nFeatures;
        this.trainHistory = data.trainHistory || [];
        logger.info(`Model dimuat dari ${filePath} (saved: ${data.savedAt})`);
        this.printWeightSummary();
    }

    // --- Debug: tampilkan bobot setiap feature ---
    printWeightSummary() {
        const featureNames = ["EMA", "RSI", "VWAP", "Volume", "ATR", "CVD"];
        logger.info("=== WEIGHT SUMMARY ===");
        this.weights.forEach((w, i) => {
            const name = featureNames[i] || `F${i}`;
            const bar = "█".repeat(Math.min(20, Math.abs(round(w * 10, 0))));
            logger.info(`  ${name.padEnd(8)} | ${w >= 0 ? "+" : ""}${round(w, 4)} | ${bar}`);
        });
        logger.info(`  Bias     | ${round(this.bias, 4)}`);
    }
}

module.exports = LogisticModel;
