/**
 * charts.js — NexCore
 * Elegant Chart.js-powered visualizations:
 * Gantt, Energy Bar, Baseline vs Optimized Line,
 * DVFS Frequency Line, Temperature Area, Core Distribution Pie
 */

const Charts = (() => {

  // Store chart instances so we can destroy/rebuild
  let _energyChart = null;
  let _compareChart = null;
  let _freqChart = null;
  let _tempChart = null;
  let _pieChart = null;

  const CHARTJS_DEFAULTS = {
    font: { family: "'DM Sans', sans-serif", size: 12 },
    color: '#9aa3be',
  };

  function applyDefaults() {
    Chart.defaults.font.family = CHARTJS_DEFAULTS.font.family;
    Chart.defaults.font.size   = CHARTJS_DEFAULTS.font.size;
    Chart.defaults.color       = CHARTJS_DEFAULTS.color;
  }

  function destroyIfExists(chart) {
    if (chart) { try { chart.destroy(); } catch(e){} }
    return null;
  }

  // ── Gantt ──────────────────────────────────────────────
  function renderGantt(tasks) {
    const wrap     = document.getElementById('ganttWrap');
    const timeline = document.getElementById('ganttTimeline');
    if (!wrap) return;
    const total = tasks.reduce((s,t) => s + t.burst, 0);
    let elapsed = 0;
    wrap.innerHTML = tasks.map(t => {
      const pct = ((t.burst / total) * 100).toFixed(2);
      elapsed += t.burst;
      return `<div class="gantt-seg" style="flex:${pct};background:${t.color}"
        title="T${t.id}: ${t.burst}ms | ${t.coreType} | ${t.freq}MHz">
        T${t.id}
      </div>`;
    }).join('');
    timeline.innerHTML = '';
    let cum = 0;
    tasks.forEach(t => {
      const pct  = (cum / total * 100).toFixed(1);
      const tick = document.createElement('span');
      tick.className = 'gantt-tick';
      tick.style.left = pct + '%';
      tick.textContent = cum + 'ms';
      timeline.appendChild(tick);
      cum += t.burst;
    });
    const end = document.createElement('span');
    end.className = 'gantt-tick'; end.style.left = '100%'; end.textContent = total + 'ms';
    timeline.appendChild(end);
  }

  // ── Energy Bar Chart (Chart.js) ────────────────────────
  function renderEnergyChart(tasks) {
    applyDefaults();
    const canvas = document.getElementById('energyChart');
    if (!canvas) return;
    _energyChart = destroyIfExists(_energyChart);
    const ctx = canvas.getContext('2d');
    _energyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: tasks.map(t => 'T' + t.id),
        datasets: [{
          label: 'Energy (J)',
          data: tasks.map(t => t.energy),
          backgroundColor: tasks.map(t => t.color + 'cc'),
          borderColor:     tasks.map(t => t.color),
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const t = tasks[items[0].dataIndex];
                return `T${t.id} — ${t.burst}ms burst`;
              },
              label: (item) => {
                const t = tasks[item.dataIndex];
                return [`Energy: ${t.energy} J`, `Core: ${t.coreType}`, `Freq: ${t.freq} MHz`];
              }
            },
            backgroundColor: '#1e2535', borderColor: '#303857', borderWidth: 1,
            titleColor: '#edf0fa', bodyColor: '#9ba3c0', padding: 10,
          }
        },
        scales: {
          x: { grid: { color: 'rgba(226,232,244,.5)', drawBorder: false }, ticks: { color: '#9aa3be' } },
          y: {
            grid: { color: 'rgba(226,232,244,.4)', drawBorder: false },
            ticks: { color: '#9aa3be', callback: v => v + ' J' },
            beginAtZero: true,
          }
        }
      }
    });
  }

  // ── Baseline vs Optimized Line Chart ──────────────────
  function renderCompareChart(tasks) {
    applyDefaults();
    const canvas = document.getElementById('compareChart');
    if (!canvas) return;
    _compareChart = destroyIfExists(_compareChart);
    const ctx = canvas.getContext('2d');

    const baseline  = tasks.map(t => +(t.burst * 15 / 3200).toFixed(3));
    const optimized = tasks.map(t => t.energy);

    _compareChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: tasks.map(t => 'T' + t.id),
        datasets: [
          {
            label: 'Baseline (P-core max)',
            data: baseline,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,.1)',
            borderWidth: 2.5,
            pointRadius: 5,
            pointBackgroundColor: '#ef4444',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            fill: true,
            tension: 0.35,
          },
          {
            label: 'Optimized (ML+DVFS)',
            data: optimized,
            borderColor: '#059669',
            backgroundColor: 'rgba(5,150,105,.1)',
            borderWidth: 2.5,
            pointRadius: 5,
            pointBackgroundColor: '#059669',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            fill: true,
            tension: 0.35,
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            labels: { color: '#4a5578', font: { size: 12 }, usePointStyle: true, pointStyleWidth: 10 }
          },
          tooltip: {
            backgroundColor: '#1e2535', borderColor: '#303857', borderWidth: 1,
            titleColor: '#edf0fa', bodyColor: '#9ba3c0', padding: 10,
            callbacks: {
              label: item => ` ${item.dataset.label}: ${item.raw} J`,
              footer: (items) => {
                const b = items[0]?.raw || 0;
                const o = items[1]?.raw || 0;
                const saved = (b - o).toFixed(3);
                return saved > 0 ? `Saved: ${saved} J` : '';
              }
            }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(226,232,244,.5)' }, ticks: { color: '#9aa3be' } },
          y: {
            grid: { color: 'rgba(226,232,244,.4)' },
            ticks: { color: '#9aa3be', callback: v => v + ' J' },
            beginAtZero: true,
          }
        }
      }
    });
  }

  // ── DVFS Frequency Line Chart ──────────────────────────
  function renderFreqChart(tasks) {
    applyDefaults();
    const canvas = document.getElementById('freqChart');
    if (!canvas) return;
    _freqChart = destroyIfExists(_freqChart);
    const ctx = canvas.getContext('2d');
    _freqChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: tasks.map(t => 'T' + t.id),
        datasets: [
          {
            label: 'Selected Frequency (MHz)',
            data: tasks.map(t => t.freq),
            borderColor: '#7c3aed',
            backgroundColor: 'rgba(124,58,237,.1)',
            borderWidth: 2.5,
            pointRadius: 5,
            pointBackgroundColor: tasks.map(t => t.color),
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            fill: true,
            tension: 0.3,
          },
          {
            label: 'Predicted Burst (ms × 100)',
            data: tasks.map(t => t.predicted * 100),
            borderColor: '#d97706',
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 3,
            pointBackgroundColor: '#d97706',
            fill: false,
            tension: 0.3,
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { color: '#4a5578', usePointStyle: true } },
          tooltip: {
            backgroundColor: '#1e2535', borderColor: '#303857', borderWidth: 1,
            titleColor: '#edf0fa', bodyColor: '#9ba3c0', padding: 10,
            callbacks: {
              label: (item) => {
                if (item.datasetIndex === 0) return ` Frequency: ${item.raw} MHz`;
                const t = tasks[item.dataIndex];
                return ` Predicted: ${t.predicted} ms`;
              }
            }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(226,232,244,.5)' }, ticks: { color: '#9aa3be' } },
          y: {
            grid: { color: 'rgba(226,232,244,.4)' },
            ticks: { color: '#9aa3be', callback: v => v >= 100 ? v + ' MHz' : v },
            beginAtZero: false,
          }
        }
      }
    });
  }

  // ── Temperature Area Chart ─────────────────────────────
  function renderTempChart(tasks, thermalLimit) {
    applyDefaults();
    const canvas = document.getElementById('tempChart');
    if (!canvas) return;
    _tempChart = destroyIfExists(_tempChart);
    const ctx = canvas.getContext('2d');
    const limit = thermalLimit || 75;
    _tempChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: tasks.map(t => 'T' + t.id),
        datasets: [
          {
            label: 'Core Temp (°C)',
            data: tasks.map(t => t.temp),
            borderColor: '#2563eb',
            backgroundColor: (ctx2) => {
              const g = ctx2.chart.ctx.createLinearGradient(0, 0, 0, 200);
              g.addColorStop(0, 'rgba(37,99,235,.35)');
              g.addColorStop(1, 'rgba(37,99,235,.02)');
              return g;
            },
            borderWidth: 2.5,
            pointRadius: tasks.map(t => t.thermalAlert ? 7 : 4),
            pointBackgroundColor: tasks.map(t => t.thermalAlert ? '#ef4444' : '#2563eb'),
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            fill: true,
            tension: 0.35,
          },
          {
            label: 'Thermal Limit',
            data: tasks.map(() => limit),
            borderColor: '#ef4444',
            borderWidth: 1.5,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { color: '#4a5578', usePointStyle: true } },
          tooltip: {
            backgroundColor: '#1e2535', borderColor: '#303857', borderWidth: 1,
            titleColor: '#edf0fa', bodyColor: '#9ba3c0', padding: 10,
            callbacks: {
              title: (items) => {
                const t = tasks[items[0].dataIndex];
                return `T${t.id}${t.thermalAlert ? ' 🔥 Migrated' : ''}`;
              },
              label: item => item.datasetIndex === 0
                ? ` Temp: ${item.raw}°C`
                : ` Limit: ${item.raw}°C`,
            }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(226,232,244,.5)' }, ticks: { color: '#9aa3be' } },
          y: {
            grid: { color: 'rgba(226,232,244,.4)' },
            ticks: { color: '#9aa3be', callback: v => v + '°C' },
          }
        }
      }
    });
  }

  // ── Core Distribution Pie ─────────────────────────────
  function renderPieChart(tasks) {
    applyDefaults();
    const canvas = document.getElementById('coreDistPie');
    if (!canvas) return;
    _pieChart = destroyIfExists(_pieChart);
    const ctx = canvas.getContext('2d');
    const perf = tasks.filter(t => t.isPerf).length;
    const eff  = tasks.length - perf;
    _pieChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Performance Cores', 'Efficiency Cores'],
        datasets: [{
          data: [perf, eff],
          backgroundColor: ['rgba(37,99,235,.85)', 'rgba(5,150,105,.85)'],
          borderColor: ['#2563eb', '#059669'],
          borderWidth: 2,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#4a5578', padding: 14, usePointStyle: true } },
          tooltip: {
            backgroundColor: '#1e2535', borderColor: '#303857', borderWidth: 1,
            titleColor: '#edf0fa', bodyColor: '#9ba3c0', padding: 10,
            callbacks: {
              label: item => ` ${item.label}: ${item.raw} task${item.raw !== 1 ? 's' : ''}`
            }
          }
        }
      }
    });
  }

  // ── Prediction grid (unchanged) ────────────────────────
  function renderPrediction(result) {
    const el = document.getElementById('predBody');
    if (!el) return;
    const items = [];
    if (result.model) {
      items.push({ k: 'Slope',     v: result.model.slope });
      items.push({ k: 'Intercept', v: result.model.intercept });
    }
    if (result.nextPredicted !== null) {
      items.push({ k: 'Next Burst Forecast', v: result.nextPredicted + ' ms' });
    }
    items.push({ k: 'Algorithm',    v: result.algoName });
    items.push({ k: 'Energy Saved', v: result.saved + ' J' });
    el.innerHTML = items.map(i => `
      <div class="pred-item">
        <div class="pred-key">${i.k}</div>
        <div class="pred-value">${i.v}</div>
      </div>`).join('');
  }

  function renderAll(result, thermalLimit) {
    renderGantt(result.tasks);
    renderEnergyChart(result.tasks);
    renderCompareChart(result.tasks);
    renderFreqChart(result.tasks);
    renderTempChart(result.tasks, thermalLimit || 75);
    renderPieChart(result.tasks);
    renderPrediction(result);
  }

  return { renderAll };

})();
