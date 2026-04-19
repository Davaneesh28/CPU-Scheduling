"""
server.py — NexCore Flask Backend
Exposes:
  POST /api/schedule  — Python ML scheduler
  POST /api/chat      — Groq AI chatbot proxy (free, fast, Llama 3)

Setup:
  pip install flask flask-cors groq
  export GROQ_API_KEY=gsk_...     (get free key at console.groq.com)
  python server.py
"""

import os, sys
from flask import Flask, request, jsonify
from flask_cors import CORS

sys.path.insert(0, os.path.dirname(__file__))
from ml_dvfs_scheduler import (ml_dvfs_schedule, simulate_temp, calc_energy,
                                dvfs_frequency, PERF_POWER, EFF_POWER, PERF_THRESH)

app  = Flask(__name__)
CORS(app)

# ── /api/schedule ─────────────────────────────────────────────────
@app.route('/api/schedule', methods=['POST'])
def schedule():
    try:
        data          = request.get_json()
        bursts        = [float(x) for x in data.get('bursts', [])]
        thermal_limit = float(data.get('thermal_limit', 75.0))
        algo          = data.get('algo', 'ml')

        if not bursts:       return jsonify({'error': 'No burst times provided'}), 400
        if len(bursts) > 20: return jsonify({'error': 'Max 20 tasks'}), 400

        if   algo == 'rr':  result = rr_schedule(bursts, thermal_limit)
        elif algo == 'sjf': result = sjf_schedule(bursts, thermal_limit)
        else:               result = ml_dvfs_schedule(bursts, thermal_limit)

        COLORS = ['#00d4ff','#b06aff','#00e87a','#ff8c42','#ffd166',
                  '#ff4d6a','#4dd9ff','#d4b0ff','#66f0a8','#ffb380',
                  '#c084fc','#34d399','#fb923c','#60a5fa','#f472b6',
                  '#a3e635','#38bdf8','#e879f9','#4ade80','#facc15']

        for i, t in enumerate(result['tasks']):
            t['color']        = COLORS[i % len(COLORS)]
            t['isPerf']       = t.pop('is_perf',       t.get('isPerf', False))
            t['coreType']     = t.pop('core_type',     t.get('coreType', 'Performance'))
            t['thermalAlert'] = t.pop('thermal_alert', t.get('thermalAlert', False))

        return jsonify({
            'tasks':          result['tasks'],
            'totalEnergy':    result['total_energy'],
            'baselineEnergy': result['baseline_energy'],
            'saved':          result['saved'],
            'peakTemp':       result['peak_temp'],
            'model':          result.get('model'),
            'nextPredicted':  result.get('next_predicted'),
            'algoName':       result.get('algo_name', 'ML + DVFS'),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── /api/chat  (Groq proxy) ───────────────────────────────────────
@app.route('/api/chat', methods=['POST'])
def chat():
    """
    Browser → POST /api/chat → Flask → Groq API (free) → Browser
    Model: llama-3.3-70b-versatile (free, very fast)
    """
    try:
        from groq import Groq

        api_key = os.environ.get('GROQ_API_KEY', '')
        if not api_key:
            return jsonify({'error':
                'GROQ_API_KEY not set.\n'
                'Get a free key at https://console.groq.com\n'
                'Then run: export GROQ_API_KEY=gsk_...'}), 500

        data     = request.get_json()
        messages = data.get('messages', [])
        system   = data.get('system', '')

        client = Groq(api_key=api_key)
        response = client.chat.completions.create(
            model    = 'llama-3.3-70b-versatile',   # free, fast
            messages = [{'role': 'system', 'content': system}] + messages,
            max_tokens  = 1024,
            temperature = 0.7,
        )

        reply = response.choices[0].message.content
        return jsonify({'reply': reply})

    except ImportError:
        return jsonify({'error':
            'groq package not installed.\n'
            'Run: pip install groq'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Round Robin ───────────────────────────────────────────────────
def rr_schedule(bursts, thermal_limit, quantum=4):
    tasks = []
    for i, burst in enumerate(bursts):
        freq   = 2400
        temp   = simulate_temp(burst, freq)
        energy = calc_energy(burst, PERF_POWER, freq)
        tasks.append({'id': i+1, 'burst': burst, 'is_perf': True,
            'core_type': 'Performance', 'core_idx': i % 2,
            'freq': freq, 'temp': round(temp, 1), 'thermal_alert': False,
            'energy': round(energy, 3), 'predicted': burst})
    total = round(sum(t['energy'] for t in tasks), 3)
    return {'tasks': tasks, 'total_energy': total, 'baseline_energy': total,
            'saved': 0.0, 'peak_temp': max(t['temp'] for t in tasks),
            'model': None, 'next_predicted': None,
            'algo_name': f'Round Robin (Q={quantum})'}


# ── SJF ───────────────────────────────────────────────────────────
def sjf_schedule(bursts, thermal_limit):
    indexed = sorted(enumerate(bursts), key=lambda x: x[1])
    tasks   = []
    for new_i, (_, burst) in enumerate(indexed):
        is_perf = burst > PERF_THRESH
        freq    = dvfs_frequency(burst, max(bursts))
        temp    = simulate_temp(burst, freq)
        power   = PERF_POWER if is_perf else EFF_POWER
        energy  = calc_energy(burst, power, freq)
        tasks.append({'id': new_i+1, 'burst': burst, 'is_perf': is_perf,
            'core_type': 'Performance' if is_perf else 'Efficiency',
            'core_idx': 0 if is_perf else 2, 'freq': freq,
            'temp': round(temp, 1), 'thermal_alert': temp > thermal_limit,
            'energy': round(energy, 3), 'predicted': burst})
    total    = round(sum(t['energy'] for t in tasks), 3)
    baseline = round(sum(calc_energy(b, PERF_POWER, 3200) for b in bursts), 3)
    return {'tasks': tasks, 'total_energy': total, 'baseline_energy': baseline,
            'saved': round(baseline - total, 3),
            'peak_temp': max(t['temp'] for t in tasks),
            'model': None, 'next_predicted': None,
            'algo_name': 'Shortest Job First'}


if __name__ == '__main__':
    key_set = bool(os.environ.get('GROQ_API_KEY'))
    print("=" * 52)
    print("  NexCore Backend — http://localhost:5000")
    print(f"  Groq AI (Llama 3): {'✓ API key found' if key_set else '✗ Set GROQ_API_KEY first'}")
    print("  Free key → https://console.groq.com")
    print("=" * 52)
    app.run(debug=True, port=5000)
