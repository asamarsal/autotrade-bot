// ============================================================
// src/backtest.js — full backtest engine
// Input: candle array dengan indikator + model terlatih
// Output: equity curve, winrate, stats lengkap
// ============================================================

const LogisticModel = require("./model");
const { buildFeatures } = require("./features");
const { appendLine, logger, round, tsToDate } = require("./utils");
const C = require("../config/constants");
const fs = require("fs");

/**
 * Jalankan backtest lengkap
 * @param {Array} candles - candle array dengan indikator sudah dihitung
 * @param {LogisticModel} model - model yang sudah di-train
 * @param {Object} opts - override threshold, bet size, dll
 */
function runBacktest(candles, model, opts = {}) {
  const {
    thresholdUp = C.THRESHOLD_UP,
    thresholdDown = C.THRESHOLD_DOWN,
    initialBalance = C.INITIAL_BALANCE,
    betSize = C.BET_SIZE,
    winMultiplier = C.WIN_MULTIPLIER,
    horizon = C.PREDICT_HORIZON,
    logPath = C.LOG_BACKTEST,
    equityPath = C.LOG_EQUITY,
  } = opts;

  const { features, labels, indices } = buildFeatures(candles, horizon);

  // Reset log files
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
  if (fs.existsSync(equityPath)) fs.unlinkSync(equityPath);
  appendLine(equityPath, "timestamp,balance,trade,pUp,signal,result");

  let balance = initialBalance;
  let win = 0;
  let loss = 0;
  let hold = 0;
  let maxBalance = initialBalance;
  let maxDrawdown = 0;
  let consecutiveWins = 0;
  let consecutiveLosses = 0;
  let maxConsecWins = 0;
  let maxConsecLosses = 0;
  let peakBalance = initialBalance;

  const equityCurve = [{ idx: 0, balance: initialBalance }];
  const trades = [];

  for (let i = 0; i < features.length; i++) {
    const pUp = model.predict(features[i]);
    const candleIdx = indices[i];
    const candle = candles[candleIdx];
    const ts = tsToDate(candle.timestamp);

    // Hanya trade kalau signal kuat
    if (pUp < thresholdUp && pUp > thresholdDown) {
      hold++;
      appendLine(equityPath, `${ts},${round(balance, 2)},hold,${round(pUp, 4)},HOLD,-`);
      continue;
    }

    const isUp = pUp >= thresholdUp;
    const signal = isUp ? "UP" : "DOWN";
    const betAmount = balance * betSize;

    // Label: apakah harga benar-benar naik?
    const actualUp = labels[i] === 1;
    const correct = (isUp && actualUp) || (!isUp && !actualUp);

    let pnl = 0;
    if (correct) {
      pnl = betAmount * (winMultiplier - 1);
      balance += pnl;
      win++;
      consecutiveWins++;
      consecutiveLosses = 0;
      maxConsecWins = Math.max(maxConsecWins, consecutiveWins);
    } else {
      pnl = -betAmount;
      balance += pnl;
      loss++;
      consecutiveLosses++;
      consecutiveWins = 0;
      maxConsecLosses = Math.max(maxConsecLosses, consecutiveLosses);
    }

    // Drawdown tracking
    if (balance > peakBalance) peakBalance = balance;
    const drawdown = (peakBalance - balance) / peakBalance;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    const trade = {
      idx: candleIdx,
      ts,
      price: candle.close,
      signal,
      pUp: round(pUp, 4),
      betAmount: round(betAmount, 2),
      pnl: round(pnl, 2),
      balance: round(balance, 2),
      result: correct ? "WIN" : "LOSS",
    };

    trades.push(trade);
    equityCurve.push({ idx: candleIdx, balance: round(balance, 2) });

    // Log ke file
    appendLine(logPath, JSON.stringify(trade));
    appendLine(
      equityPath,
      `${ts},${round(balance, 2)},${signal},${round(pUp, 4)},${signal},${correct ? "WIN" : "LOSS"}`
    );
  }

  const totalTrades = win + loss;
  const winRate = totalTrades > 0 ? win / totalTrades : 0;
  const roi = (balance - initialBalance) / initialBalance;

  // Profit Factor
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

  // Expectancy per trade
  const expectancy = totalTrades > 0
    ? trades.reduce((a, t) => a + t.pnl, 0) / totalTrades
    : 0;

  const stats = {
    totalCandles: features.length,
    totalTrades,
    hold,
    win,
    loss,
    winRate: round(winRate, 4),
    coverage: round(totalTrades / features.length, 4),
    initialBalance: round(initialBalance, 2),
    finalBalance: round(balance, 2),
    roi: round(roi, 4),
    roiPct: round(roi * 100, 2) + "%",
    maxDrawdown: round(maxDrawdown, 4),
    maxDrawdownPct: round(maxDrawdown * 100, 2) + "%",
    profitFactor: round(profitFactor, 4),
    expectancy: round(expectancy, 2),
    maxConsecWins,
    maxConsecLosses,
    sharpeApprox: computeSharpe(trades),
  };

  return { stats, equityCurve, trades };
}

// Sharpe ratio approximasi sederhana (tanpa risk-free rate)
function computeSharpe(trades) {
  if (trades.length < 2) return 0;
  const returns = trades.map(t => t.pnl);
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const std = Math.sqrt(
    returns.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / returns.length
  );
  return std > 0 ? round((avg / std) * Math.sqrt(252), 4) : 0; // annualized
}

/**
 * Walk-Forward Validation
 * Train di window pertama, test di window berikutnya, geser
 */
function walkForward(candles, model, nFolds = 5) {
  const foldSize = Math.floor(candles.length / nFolds);
  const results = [];

  logger.info(`Walk-forward validation: ${nFolds} folds, ${foldSize} candle per fold`);

  for (let fold = 0; fold < nFolds - 1; fold++) {
    const trainEnd = (fold + 1) * foldSize;
    const testEnd = Math.min((fold + 2) * foldSize, candles.length);

    const trainCandles = candles.slice(0, trainEnd);
    const testCandles = candles.slice(trainEnd, testEnd);

    // Re-train model di training window
    const { buildFeatures: bf } = require("./features");
    const { features: trainX, labels: trainY } = bf(trainCandles);
    const { features: testX, labels: testY } = bf(testCandles);

    if (trainX.length < 50 || testX.length < 10) continue;

    // Clone model baru untuk setiap fold
    const foldModel = new LogisticModel(model.nFeatures);
    foldModel.train(trainX, trainY, 300, C.LEARNING_RATE, false);

    const evalResult = foldModel.evaluate(testX, testY);
    results.push({ fold: fold + 1, trainSize: trainX.length, testSize: testX.length, ...evalResult });

    logger.info(`Fold ${fold + 1}: winRate=${evalResult.accuracy}, trades=${evalResult.tradeCount}, coverage=${evalResult.coverage}`);
  }

  const avgAccuracy = results.reduce((a, r) => a + r.accuracy, 0) / results.length;
  logger.info(`Walk-forward avg accuracy: ${round(avgAccuracy, 4)}`);

  return { results, avgAccuracy: round(avgAccuracy, 4) };
}

module.exports = { runBacktest, walkForward };
