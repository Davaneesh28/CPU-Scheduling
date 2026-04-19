/**
 * scheduler.js
 * Core scheduling engine: ML+DVFS, Round Robin, SJF
 * Thermal-aware redistribution, energy modeling
 */

const Scheduler = (() => {

  // ── Config ──────────────────────────────────────────
  const PERF_POWER  = 15;  // watts, performance core
  const EFF_POWER   = 6;   // watts, efficiency core
  const PERF_THRESH = 6;   // burst ms > this → performance core
  const FREQ_STEPS  = [800, 1200, 1600, 2400, 3200]; // MHz

  const TASK_COLORS = [
    '#00d4ff','#b06aff','#00e87a','#ff8c42',
    '#ffd166','#ff4d6a','#4dd9ff','#d4b0ff',
    '#66f0a8','#ffb380'
  ];

  // ── Linear Regression (simple 1-feature) ─────────────
  function linearRegression(xs, ys) {
    const n  = xs.length;
    const sx = xs.reduce((a, b) => a + b, 0);
    const sy = ys.reduce((a, b) => a + b, 0);
    const sxy = xs.reduce((a, x, i) => a + x * ys[i], 0);
    const sx2 = xs.reduce((a, x) => a + x * x, 0);
    const m  = (n * sxy - sx * sy) / (n * sx2 - sx * sx || 1);
    const b  = (sy - m * sx) / n;
    return { slope: m, intercept: b, predict: x => m * x + b };
  }

  // ── DVFS: pick frequency based on predicted load ──────
  function dvfsFrequency(predictedLoad, maxLoad) {
    const ratio = Math.min(predictedLoad / (maxLoad || 1), 1);
    const idx   = Math.round(ratio * (FREQ_STEPS.length - 1));
    return FREQ_STEPS[idx];
  }

  // ── Thermal simulation ────────────────────────────────
  function simulateTemp(burst, freq, ambientBase = 40) {
    // Rough model: longer burst + higher freq = more heat
    const freqFactor = freq / 3200;
    const temp = ambientBase + burst * 1.2 * freqFactor + Math.random() * 4;
    return +temp.toFixed(1);
  }

  // ── Energy calculation ────────────────────────────────
  function calcEnergy(burst, power, freq) {
    const freqScale = freq / 3200;
    // Power scales with freq; time scales inversely (higher freq = faster)
    const effectivePower = power * freqScale;
    const effectiveTime  = burst / (freqScale * 1000); // seconds
    return +(effectivePower * effectiveTime).toFixed(3);
  }

  // ── ML + DVFS scheduler ───────────────────────────────
  function mlDvfsSchedule(bursts, thermalLimit) {
    const xs   = bursts.map((_, i) => i + 1);
    const model = linearRegression(xs, bursts);
    const maxBurst = Math.max(...bursts);
    const predictedLoads = bursts.map((_, i) => Math.max(0, model.predict(i + 1)));
    const nextPredicted  = Math.max(0, model.predict(bursts.length + 1));

    let coreTemps = [40, 40, 40, 40]; // 2 perf + 2 eff cores

    const tasks = bursts.map((burst, i) => {
      const predicted = predictedLoads[i];
      const freq      = dvfsFrequency(predicted, maxBurst);
      const isPerf    = burst > PERF_THRESH;

      // Thermal-aware: redistribute if core is hot
      let coreIdx = isPerf ? 0 : 2;
      let altIdx  = isPerf ? 1 : 3;
      let temp    = simulateTemp(burst, freq, coreTemps[coreIdx]);

      if (temp > thermalLimit) {
        // Move to alternate core
        coreIdx = altIdx;
        temp = simulateTemp(burst, freq * 0.8, coreTemps[coreIdx]);
        coreTemps[coreIdx] += 3;
      } else {
        coreTemps[coreIdx] += 2;
      }

      const power  = isPerf ? PERF_POWER : EFF_POWER;
      const energy = calcEnergy(burst, power, freq);

      return {
        id:       i + 1,
        burst,
        isPerf,
        coreType: isPerf ? 'Performance' : 'Efficiency',
        coreIdx,
        freq,
        temp,
        thermalAlert: temp > thermalLimit,
        energy,
        color: TASK_COLORS[i % TASK_COLORS.length],
        predicted: +predicted.toFixed(2),
      };
    });

    const totalEnergy   = +tasks.reduce((s, t) => s + t.energy, 0).toFixed(3);
    const baselineEnergy = +bursts.reduce((s, b) => s + calcEnergy(b, PERF_POWER, 3200), 0).toFixed(3);
    const saved         = +(baselineEnergy - totalEnergy).toFixed(3);
    const peakTemp      = Math.max(...tasks.map(t => t.temp));

    return {
      tasks, totalEnergy, baselineEnergy, saved, peakTemp,
      model: { slope: +model.slope.toFixed(3), intercept: +model.intercept.toFixed(3) },
      nextPredicted: +nextPredicted.toFixed(2),
      algoName: 'ML + DVFS',
    };
  }

  // ── Round Robin scheduler ─────────────────────────────
  function rrSchedule(bursts, thermalLimit, quantum = 4) {
    const tasks = bursts.map((burst, i) => ({
      id:       i + 1,
      burst,
      isPerf:   true,
      coreType: 'Performance',
      coreIdx:  i % 2,
      freq:     2400,
      temp:     simulateTemp(burst, 2400),
      thermalAlert: false,
      energy:   calcEnergy(burst, PERF_POWER, 2400),
      color:    TASK_COLORS[i % TASK_COLORS.length],
      predicted: burst,
      quantum,
    }));

    const totalEnergy   = +tasks.reduce((s, t) => s + t.energy, 0).toFixed(3);
    const baselineEnergy = totalEnergy;
    const saved = 0;
    const peakTemp = Math.max(...tasks.map(t => t.temp));

    return {
      tasks, totalEnergy, baselineEnergy, saved, peakTemp,
      model: null, nextPredicted: null,
      algoName: 'Round Robin (Q=' + quantum + ')',
    };
  }

  // ── SJF scheduler ─────────────────────────────────────
  function sjfSchedule(bursts, thermalLimit) {
    const indexed = bursts.map((burst, i) => ({ orig: i + 1, burst }));
    indexed.sort((a, b) => a.burst - b.burst);

    const tasks = indexed.map((t, i) => {
      const isPerf = t.burst > PERF_THRESH;
      const freq   = dvfsFrequency(t.burst, Math.max(...bursts));
      const temp   = simulateTemp(t.burst, freq);
      return {
        id:       i + 1,
        origId:   t.orig,
        burst:    t.burst,
        isPerf,
        coreType: isPerf ? 'Performance' : 'Efficiency',
        coreIdx:  isPerf ? 0 : 2,
        freq,
        temp,
        thermalAlert: temp > thermalLimit,
        energy:   calcEnergy(t.burst, isPerf ? PERF_POWER : EFF_POWER, freq),
        color:    TASK_COLORS[(t.orig - 1) % TASK_COLORS.length],
        predicted: t.burst,
      };
    });

    const totalEnergy    = +tasks.reduce((s, t) => s + t.energy, 0).toFixed(3);
    const baselineEnergy = +bursts.reduce((s, b) => s + calcEnergy(b, PERF_POWER, 3200), 0).toFixed(3);
    const saved          = +(baselineEnergy - totalEnergy).toFixed(3);
    const peakTemp       = Math.max(...tasks.map(t => t.temp));

    return {
      tasks, totalEnergy, baselineEnergy, saved, peakTemp,
      model: null, nextPredicted: null,
      algoName: 'Shortest Job First',
    };
  }

  // ── Public API ─────────────────────────────────────────
  function schedule(bursts, algo, thermalLimit) {
    switch (algo) {
      case 'rr':  return rrSchedule(bursts, thermalLimit);
      case 'sjf': return sjfSchedule(bursts, thermalLimit);
      default:    return mlDvfsSchedule(bursts, thermalLimit);
    }
  }

  return { schedule, TASK_COLORS };

})();
