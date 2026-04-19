"""
ml_dvfs_scheduler.py
ML + DVFS CPU Scheduler — Python port of CalFuxk's scheduler.js
"""

import random
import math


# ── Config ────────────────────────────────────────────────────────────
PERF_POWER  = 15       # watts, performance core
EFF_POWER   = 6        # watts, efficiency core
PERF_THRESH = 6        # burst ms > this → performance core
FREQ_STEPS  = [800, 1200, 1600, 2400, 3200]  # MHz


# ── Linear Regression (1-feature, no external libs needed) ───────────
def linear_regression(xs: list[float], ys: list[float]) -> dict:
    """
    Fits a simple y = mx + b line through (xs, ys).
    Returns slope, intercept, and a predict function.
    """
    n   = len(xs)
    sx  = sum(xs)
    sy  = sum(ys)
    sxy = sum(x * y for x, y in zip(xs, ys))
    sx2 = sum(x * x for x in xs)

    denom = n * sx2 - sx * sx or 1          # guard div-by-zero
    m = (n * sxy - sx * sy) / denom
    b = (sy - m * sx) / n

    return {
        "slope"    : round(m, 3),
        "intercept": round(b, 3),
        "predict"  : lambda x: m * x + b,
    }


# ── DVFS: choose frequency from predicted load ────────────────────────
def dvfs_frequency(predicted_load: float, max_load: float) -> int:
    ratio = min(predicted_load / (max_load or 1), 1.0)
    idx   = round(ratio * (len(FREQ_STEPS) - 1))
    return FREQ_STEPS[idx]


# ── Thermal simulation ────────────────────────────────────────────────
def simulate_temp(burst: float, freq: int, ambient_base: float = 40.0) -> float:
    freq_factor = freq / 3200
    temp = ambient_base + burst * 1.2 * freq_factor + random.uniform(0, 4)
    return round(temp, 1)


# ── Energy calculation ────────────────────────────────────────────────
def calc_energy(burst: float, power: float, freq: int) -> float:
    freq_scale      = freq / 3200
    effective_power = power * freq_scale
    effective_time  = burst / (freq_scale * 1000)   # seconds
    return round(effective_power * effective_time, 3)


# ── ML + DVFS Scheduler ───────────────────────────────────────────────
def ml_dvfs_schedule(bursts: list[float], thermal_limit: float = 75.0) -> dict:
    """
    Main scheduler:
    - Trains a linear regression on burst-time history
    - Uses predictions to select DVFS frequency per task
    - Assigns tasks to P-cores (burst > 6ms) or E-cores
    - Migrates hot tasks to alternate cores if temp exceeds thermal_limit
    """
    xs    = [i + 1 for i in range(len(bursts))]
    model = linear_regression(xs, bursts)

    max_burst        = max(bursts)
    predicted_loads  = [max(0.0, model["predict"](i + 1)) for i in range(len(bursts))]
    next_predicted   = round(max(0.0, model["predict"](len(bursts) + 1)), 2)

    core_temps = [40.0, 40.0, 40.0, 40.0]   # [P-core0, P-core1, E-core0, E-core1]
    tasks = []

    for i, burst in enumerate(bursts):
        predicted = predicted_loads[i]
        freq      = dvfs_frequency(predicted, max_burst)
        is_perf   = burst > PERF_THRESH

        # Pick primary / alternate core index
        core_idx  = 0 if is_perf else 2
        alt_idx   = 1 if is_perf else 3

        temp = simulate_temp(burst, freq, core_temps[core_idx])
        thermal_alert = False

        if temp > thermal_limit:
            # Migrate to alternate core at reduced frequency
            core_idx      = alt_idx
            freq_reduced  = int(freq * 0.8)
            temp          = simulate_temp(burst, freq_reduced, core_temps[core_idx])
            core_temps[core_idx] += 3
            thermal_alert = True
        else:
            core_temps[core_idx] += 2

        power  = PERF_POWER if is_perf else EFF_POWER
        energy = calc_energy(burst, power, freq)

        tasks.append({
            "id"           : i + 1,
            "burst"        : burst,
            "is_perf"      : is_perf,
            "core_type"    : "Performance" if is_perf else "Efficiency",
            "core_idx"     : core_idx,
            "freq"         : freq,
            "temp"         : temp,
            "thermal_alert": thermal_alert,
            "energy"       : energy,
            "predicted"    : round(predicted, 2),
        })

    total_energy    = round(sum(t["energy"] for t in tasks), 3)
    baseline_energy = round(sum(calc_energy(b, PERF_POWER, 3200) for b in bursts), 3)
    saved           = round(baseline_energy - total_energy, 3)
    peak_temp       = max(t["temp"] for t in tasks)

    return {
        "tasks"          : tasks,
        "total_energy"   : total_energy,
        "baseline_energy": baseline_energy,
        "saved"          : saved,
        "peak_temp"      : peak_temp,
        "model"          : {"slope": model["slope"], "intercept": model["intercept"]},
        "next_predicted" : next_predicted,
        "algo_name"      : "ML + DVFS",
    }


# ── Pretty-print results ──────────────────────────────────────────────
def print_results(result: dict) -> None:
    print("\n" + "=" * 60)
    print(f"  Algorithm : {result['algo_name']}")
    print(f"  Model     : slope={result['model']['slope']}, "
          f"intercept={result['model']['intercept']}")
    print(f"  Next burst forecast : {result['next_predicted']} ms")
    print(f"  Total energy        : {result['total_energy']} J")
    print(f"  Baseline energy     : {result['baseline_energy']} J")
    print(f"  Energy saved        : {result['saved']} J")
    print(f"  Peak temperature    : {result['peak_temp']} °C")
    print("=" * 60)

    header = f"{'Task':<6}{'Burst':>8}{'Core':<14}{'Freq':>10}{'Temp':>8}{'Energy':>9}{'Alert':>7}"
    print(header)
    print("-" * 60)
    for t in result["tasks"]:
        alert = "🔥" if t["thermal_alert"] else ""
        print(
            f"  T{t['id']:<4}"
            f"{t['burst']:>6} ms"
            f"  {t['core_type']:<13}"
            f"{t['freq']:>7} MHz"
            f"{t['temp']:>7}°C"
            f"{t['energy']:>8} J"
            f"  {alert}"
        )
    print("=" * 60 + "\n")


# ── Entry point ───────────────────────────────────────────────────────
if __name__ == "__main__":
    # ---- Edit these values to test different scenarios ----
    burst_times   = [3, 7, 2, 9, 5, 8, 1, 6, 4, 10]   # ms per task
    thermal_limit = 75.0                                  # °C

    result = ml_dvfs_schedule(burst_times, thermal_limit)
    print_results(result)
