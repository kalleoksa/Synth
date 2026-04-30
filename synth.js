// ---- Audio context ----
const AC = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = AC.createGain();
masterGain.gain.value = 0.7;
masterGain.connect(AC.destination);

// ---- Patch state ----
const cables = [];   // { fromId, fromPort, toId, toPort, color }
let pending = null;  // { id, port, dot } — output port waiting to be connected
const COLORS = ['#378ADD', '#D85A30', '#639922', '#8E44AD', '#BA7517', '#D4537E'];
let colorIdx = 0;

const mods = {};     // id → module descriptor
let modCount = 0;
function uid() { return 'm' + (++modCount); }

// ---- Canvas view (pan + zoom) ----
const view = { scale: 1, tx: 0, ty: 0 };
function applyView() {
  const c = document.getElementById('canvas-content');
  if (c) c.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
}
function resetView() {
  view.scale = 1; view.tx = 0; view.ty = 0;
  applyView();
}

// ---- Helpers ----
function midiToFreq(n) { return 440 * Math.pow(2, (n - 69) / 12); }
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteName(m) { return noteNames[m % 12] + Math.floor(m / 12 - 1); }
function rp(off = 20) { return off + Math.floor(Math.random() * 30); }
function setStatus(s) { document.getElementById('status').textContent = s; }

// ---- Audio connect/disconnect ----
// Each module descriptor exposes:
//   audioIn   — AudioNode to connect audio signals into (or null)
//   audioOut  — AudioNode to connect audio signals from (or null)
//   modIn     — AudioParam for modulation input (or null)
//   rateModIn — AudioParam for LFO rate modulation (or null)
//   modOut    — AudioNode for ARP mod CV output (or null)

function resolveNodes(fromId, fromPort, toId, toPort) {
  const src = mods[fromId], dst = mods[toId];
  if (!src || !dst) return null;

  const srcNode = fromPort === 'out'     ? src.audioOut
                : fromPort === 'mod-out' ? src.modOut
                : null;

  const dstNode = toPort === 'in'       ? dst.audioIn
                : toPort === 'mod'      ? dst.modIn
                : toPort === 'rate-mod' ? dst.rateModIn
                : null;

  return (srcNode && dstNode) ? { srcNode, dstNode } : null;
}

function connectPair(fromId, fromPort, toId, toPort) {
  const n = resolveNodes(fromId, fromPort, toId, toPort);
  if (n) try { n.srcNode.connect(n.dstNode); } catch (e) {}
}

function disconnectPair(fromId, fromPort, toId, toPort) {
  const n = resolveNodes(fromId, fromPort, toId, toPort);
  if (n) try { n.srcNode.disconnect(n.dstNode); } catch (e) {}
}

// ---- Port click handling ----
function removeCablesAtPort(id, port) {
  const toRemove = cables.filter(c =>
    (c.fromId === id && c.fromPort === port) ||
    (c.toId   === id && c.toPort   === port)
  );

  toRemove.forEach(c => {
    disconnectPair(c.fromId, c.fromPort, c.toId, c.toPort);
    cables.splice(cables.indexOf(c), 1);
  });

  toRemove.forEach(c => {
    refreshDotState(c.fromId, c.fromPort, 'out');
    refreshDotState(c.toId,   c.toPort,   'in');
  });

  redrawCables();
}

function refreshDotState(id, port, dir) {
  const m = mods[id]; if (!m) return;
  const dot = m.el.querySelector(`.port-dot[data-port="${port}"][data-dir="${dir}"]`);
  if (!dot) return;

  const stillConnected = cables.some(c =>
    (c.fromId === id && c.fromPort === port) ||
    (c.toId   === id && c.toPort   === port)
  );
  dot.classList.toggle('connected', stillConnected);
}

function onPortClick(e) {
  e.stopPropagation();
  const dot = e.currentTarget;
  const { id, port, dir } = dot.dataset;

  if (dot.classList.contains('connected') && dir === 'in' && !pending) {
    removeCablesAtPort(id, port);
    return;
  }

  if (!pending) {
    if (dir !== 'out') return;
    pending = { id, port, dot };
    dot.classList.add('pending');
    return;
  }

  if (pending.dot === dot) {
    dot.classList.remove('pending');
    pending = null;
    return;
  }

  if (dir === 'out') {
    pending.dot.classList.remove('pending');
    pending = { id, port, dot };
    dot.classList.add('pending');
    return;
  }

  const color = COLORS[colorIdx++ % COLORS.length];
  cables.push({ fromId: pending.id, fromPort: pending.port, toId: id, toPort: port, color });
  connectPair(pending.id, pending.port, id, port);
  pending.dot.classList.remove('pending');
  [pending.dot, dot].forEach(d => d.classList.add('connected'));
  pending = null;
  redrawCables();
}

function clearAllCables() {
  cables.forEach(c => disconnectPair(c.fromId, c.fromPort, c.toId, c.toPort));
  cables.length = 0;
  document.querySelectorAll('.port-dot').forEach(d => d.classList.remove('connected', 'pending'));
  pending = null;
  redrawCables();
  setStatus('cables cleared');
}

// ---- Port HTML helper ----
function portH(id, port, dir, label) {
  const cls = dir === 'out' ? 'port output' : 'port';
  return `<div class="${cls}">
    <div class="port-dot" data-id="${id}" data-port="${port}" data-dir="${dir}"></div>
    <span class="port-label">${label}</span>
  </div>`;
}

// ---- Spawn helper ----
function spawnModule(id, desc, html, x, y, extraClass = '') {
  const el = document.createElement('div');
  el.className = 'module' + (extraClass ? ' ' + extraClass : '');
  el.id = id;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.innerHTML = html;
  document.getElementById('canvas-content').appendChild(el);
  el.querySelectorAll('.port-dot').forEach(d => d.addEventListener('click', onPortClick));
  desc.el = el;
  desc.id = id;
  mods[id] = desc;
  makeDraggable(el, id);
}

// ---- Module removal ----
function removeModule(id) {
  const m = mods[id]; if (!m) return;
  const toRemove = cables.filter(c => c.fromId === id || c.toId === id);
  toRemove.forEach(c => {
    disconnectPair(c.fromId, c.fromPort, c.toId, c.toPort);
    cables.splice(cables.indexOf(c), 1);
  });
  toRemove.forEach(c => {
    if (c.fromId !== id) refreshDotState(c.fromId, c.fromPort, 'out');
    if (c.toId   !== id) refreshDotState(c.toId,   c.toPort,   'in');
  });

  try {
    if (m.osc)    m.osc.stop();
    if (m.modSrc) m.modSrc.stop();
  } catch (e) {}
  if (m.intervalId) clearInterval(m.intervalId);

  m.el.remove();
  delete mods[id];
  redrawCables();
  setStatus('module deleted');
}

// ---- OSC module ----
function addOsc(x, y) {
  const id = uid();
  x = x || rp(); y = y || rp(80);
  const osc = AC.createOscillator();
  const gain = AC.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = 440;
  gain.gain.value = 0.8;
  osc.connect(gain);
  osc.start();

  const desc = {
    type: 'osc', osc, gain, octave: 0, currentMidi: null,
    audioIn: null, audioOut: gain,
    modIn: osc.detune,       // LFO → detune
    rateModIn: null, modOut: null
  };

  spawnModule(id, desc, `
    <div class="mod-title">OSC</div>
    <div class="wave-row">
      <button class="wave-btn active" onclick="setWaveBtn('${id}','osc','sawtooth',this)">SAW</button>
      <button class="wave-btn" onclick="setWaveBtn('${id}','osc','square',this)">SQR</button>
      <button class="wave-btn" onclick="setWaveBtn('${id}','osc','sine',this)">SIN</button>
      <button class="wave-btn" onclick="setWaveBtn('${id}','osc','triangle',this)">TRI</button>
    </div>
    <div class="mod-knob">
      <label>detune</label>
      <input type="range" min="-50" max="50" value="0" step="1"
        oninput="mods['${id}'].osc.detune.value=+this.value;this.nextElementSibling.textContent=this.value+'ct'">
      <span>0ct</span>
    </div>
    <div class="mod-knob">
      <label>octave</label>
      <input type="range" min="-2" max="2" value="0" step="1"
        oninput="mods['${id}'].octave=+this.value;refreshOscFreq('${id}');this.nextElementSibling.textContent=(this.value>0?'+':'')+this.value">
      <span>0</span>
    </div>
    <div class="mod-knob">
      <label>level</label>
      <input type="range" min="0" max="1" value="0.8" step="0.01"
        oninput="mods['${id}'].gain.gain.value=+this.value;this.nextElementSibling.textContent=Math.round(this.value*100)+'%'">
      <span>80%</span>
    </div>
    <div class="ports">
      <div class="port-col">${portH(id, 'mod', 'in', 'mod')}</div>
      <div class="port-col outputs">${portH(id, 'out', 'out', 'out')}</div>
    </div>`, x, y);
}

function refreshOscFreq(id) {
  const m = mods[id];
  if (!m || m.currentMidi == null) return;
  m.osc.frequency.value = midiToFreq(m.currentMidi + m.octave * 12);
}

// ---- Filter module ----
function addFilter(x, y) {
  const id = uid();
  x = x || rp(); y = y || rp(80);
  const f = AC.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 2000; f.Q.value = 1;

  const desc = {
    type: 'filter', f,
    audioIn: f, audioOut: f,
    modIn: f.frequency,   // LFO or ARP mod → cutoff
    rateModIn: null, modOut: null
  };

  spawnModule(id, desc, `
    <div class="mod-title">Filter LP</div>
    <div class="mod-knob">
      <label>cutoff</label>
      <input type="range" min="20" max="20000" value="2000" step="1"
        oninput="mods['${id}'].f.frequency.value=+this.value;this.nextElementSibling.textContent=this.value>999?(this.value/1000).toFixed(1)+'kHz':this.value+'Hz'">
      <span>2.0kHz</span>
    </div>
    <div class="mod-knob">
      <label>resonance</label>
      <input type="range" min="0.1" max="20" value="1" step="0.1"
        oninput="mods['${id}'].f.Q.value=+this.value;this.nextElementSibling.textContent=parseFloat(this.value).toFixed(1)">
      <span>1.0</span>
    </div>
    <div class="ports">
      <div class="port-col">
        ${portH(id, 'in', 'in', 'in')}
        ${portH(id, 'mod', 'in', 'mod')}
      </div>
      <div class="port-col outputs">${portH(id, 'out', 'out', 'out')}</div>
    </div>`, x, y);
}

// ---- LFO module ----
function addLfo(x, y) {
  const id = uid();
  x = x || rp(); y = y || rp(80);
  const osc = AC.createOscillator();
  const gain = AC.createGain();
  osc.type = 'sine'; osc.frequency.value = 1; gain.gain.value = 500;
  osc.connect(gain); osc.start();

  const desc = {
    type: 'lfo', osc, gain,
    audioIn: null, audioOut: gain,
    modIn: null, modOut: null,
    rateModIn: osc.frequency  // ARP mod → LFO rate
  };

  spawnModule(id, desc, `
    <div class="mod-title">LFO</div>
    <div class="wave-row">
      <button class="wave-btn active" onclick="setWaveBtn('${id}','lfo','sine',this)">SIN</button>
      <button class="wave-btn" onclick="setWaveBtn('${id}','lfo','triangle',this)">TRI</button>
      <button class="wave-btn" onclick="setWaveBtn('${id}','lfo','square',this)">SQR</button>
    </div>
    <div class="mod-knob">
      <label>rate</label>
      <input type="range" min="0.05" max="20" value="1" step="0.05"
        oninput="mods['${id}'].osc.frequency.value=+this.value;this.nextElementSibling.textContent=parseFloat(this.value).toFixed(2)+'Hz'">
      <span>1.00Hz</span>
    </div>
    <div class="mod-knob">
      <label>depth</label>
      <input type="range" min="0" max="4000" value="500" step="10"
        oninput="mods['${id}'].gain.gain.value=+this.value;this.nextElementSibling.textContent=this.value">
      <span>500</span>
    </div>
    <div class="ports">
      <div class="port-col">${portH(id, 'rate-mod', 'in', 'rate')}</div>
      <div class="port-col outputs">${portH(id, 'out', 'out', 'out')}</div>
    </div>`, x, y);
}

// ---- ARP module ----
// pitch-out: drives OSC frequencies via JS (not Web Audio — discrete pitches)
// mod-out:   ConstantSourceNode whose value steps 0–1 across the sequence,
//            scaled by mod depth → patch to filter mod or LFO rate
function addArp(x, y) {
  const id = uid();
  x = x || rp(); y = y || rp(80);

  const modSrc = AC.createConstantSource();
  modSrc.offset.value = 0;
  modSrc.start();
  const modGain = AC.createGain();
  modGain.gain.value = 1000;
  modSrc.connect(modGain);

  const desc = {
    type: 'arp',
    on: false, dir: 'up', rate: 4, gate: 0.5, octaves: 1,
    heldKeys: new Set(),
    step: 0, stepDir: 1, intervalId: null, currentMidi: null,
    modSrc, modGain,
    audioIn: null, audioOut: null,
    modIn: null, rateModIn: null,
    modOut: modGain  // ConstantSource → filter mod / LFO rate
  };

  spawnModule(id, desc, `
    <div class="mod-title">
      <span>ARP</span>
      <label class="mod-on"><input type="checkbox" onchange="toggleArp('${id}',this.checked)"> on</label>
    </div>
    <div class="wave-row" id="${id}-dir">
      <button class="wave-btn active" onclick="setArpDir('${id}','up',this)">UP</button>
      <button class="wave-btn" onclick="setArpDir('${id}','down',this)">DN</button>
      <button class="wave-btn" onclick="setArpDir('${id}','updown',this)">UD</button>
    </div>
    <div class="mod-knob">
      <label>rate</label>
      <input type="range" min="0.5" max="16" value="4" step="0.5"
        oninput="mods['${id}'].rate=+this.value;this.nextElementSibling.textContent=parseFloat(this.value).toFixed(1)+'Hz';restartArp('${id}')">
      <span>4.0Hz</span>
    </div>
    <div class="mod-knob">
      <label>gate</label>
      <input type="range" min="0.05" max="0.99" value="0.5" step="0.01"
        oninput="mods['${id}'].gate=+this.value;this.nextElementSibling.textContent=Math.round(this.value*100)+'%'">
      <span>50%</span>
    </div>
    <div class="mod-knob">
      <label>octaves</label>
      <input type="range" min="1" max="4" value="1" step="1"
        oninput="mods['${id}'].octaves=+this.value;this.nextElementSibling.textContent=this.value">
      <span>1</span>
    </div>
    <div class="mod-knob">
      <label>mod depth</label>
      <input type="range" min="0" max="5000" value="1000" step="10"
        oninput="mods['${id}'].modGain.gain.value=+this.value;this.nextElementSibling.textContent=this.value">
      <span>1000</span>
    </div>
    <div class="arp-seq" id="${id}-seq"></div>
    <div class="ports">
      <div class="port-col outputs">
        ${portH(id, 'pitch-out', 'out', 'pitch')}
        ${portH(id, 'mod-out', 'out', 'mod cv')}
      </div>
    </div>`, x, y, 'arp-mod');
}

// ---- Output module ----
function addOutput(x, y) {
  const id = uid();
  x = x || rp(); y = y || rp(80);

  const desc = {
    type: 'output',
    audioIn: masterGain, audioOut: null,
    modIn: null, rateModIn: null, modOut: null
  };

  spawnModule(id, desc, `
    <div class="mod-title">Output</div>
    <div class="mod-knob">
      <label>volume</label>
      <input type="range" min="0" max="1" value="0.7" step="0.01"
        oninput="masterGain.gain.value=+this.value;this.nextElementSibling.textContent=Math.round(this.value*100)+'%'">
      <span>70%</span>
    </div>
    <div class="ports">
      <div class="port-col">${portH(id, 'in', 'in', 'in')}</div>
    </div>`, x, y, 'output-mod');
}

// ---- Wave buttons ----
function setWaveBtn(id, type, wave, btn) {
  mods[id].osc.type = wave;
  btn.closest('.wave-row').querySelectorAll('.wave-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ---- ARP logic ----
function buildArpSeq(id) {
  const m = mods[id];
  const base = Array.from(m.heldKeys).sort((a, b) => a - b);
  if (!base.length) return [];
  const seq = [];
  for (let o = 0; o < m.octaves; o++) base.forEach(n => seq.push(n + o * 12));
  return seq;
}

function arpTick(id) {
  const m = mods[id]; if (!m) return;
  const seq = buildArpSeq(id);

  if (m.currentMidi != null) { highlightKey(m.currentMidi, false); m.currentMidi = null; }
  if (!seq.length) { document.getElementById(id + '-seq').textContent = ''; return; }

  m.step = ((m.step % seq.length) + seq.length) % seq.length;
  const midi = seq[m.step];

  // drive all OSC frequencies
  Object.values(mods).forEach(mod => {
    if (mod.type === 'osc') {
      mod.currentMidi = midi;
      mod.osc.frequency.value = midiToFreq(midi + (mod.octave || 0) * 12);
    }
  });

  // mod CV: normalized step position 0–1
  m.modSrc.offset.value = m.step / Math.max(seq.length - 1, 1);

  m.currentMidi = midi;
  highlightKey(midi, true, 'on');
  triggerEnvOn();

  // gate off
  const gateDur = (1 / m.rate) * m.gate * 1000;
  const capMidi = midi;
  setTimeout(() => {
    if (m.currentMidi === capMidi) { highlightKey(capMidi, false); triggerEnvOff(); }
  }, gateDur);

  document.getElementById(id + '-seq').textContent =
    seq.map((n, i) => i === m.step ? '[' + noteName(n) + ']' : noteName(n)).join(' ');

  // advance step
  if (m.dir === 'up') {
    m.step = (m.step + 1) % seq.length;
  } else if (m.dir === 'down') {
    m.step = (m.step - 1 + seq.length) % seq.length;
  } else {
    m.step += m.stepDir;
    if (m.step >= seq.length) { m.stepDir = -1; m.step = Math.max(0, seq.length - 2); }
    else if (m.step < 0) { m.stepDir = 1; m.step = Math.min(1, seq.length - 1); }
  }
}

function toggleArp(id, on) {
  const m = mods[id]; m.on = on;
  if (on) {
    m.step = 0; m.stepDir = 1;
    m.intervalId = setInterval(() => arpTick(id), 1000 / m.rate);
  } else {
    clearInterval(m.intervalId); m.intervalId = null;
    if (m.currentMidi != null) { highlightKey(m.currentMidi, false); m.currentMidi = null; }
    document.getElementById(id + '-seq').textContent = '';
  }
}

function restartArp(id) {
  const m = mods[id];
  if (m.on) { clearInterval(m.intervalId); m.intervalId = setInterval(() => arpTick(id), 1000 / m.rate); }
}

function setArpDir(id, dir, btn) {
  mods[id].dir = dir; mods[id].step = 0; mods[id].stepDir = 1;
  document.querySelectorAll(`#${id}-dir .wave-btn`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ---- Dragging + long-press ----
const LONG_PRESS_MS = 600;
const LONG_PRESS_MOVE = 8;

function makeDraggable(el, id) {
  let down = false, dragging = false;
  let startX = 0, startY = 0;     // pointer start (screen)
  let elStartX = 0, elStartY = 0; // module start (canvas coords)
  let lpTimer = null, captured = false;

  el.addEventListener('pointerdown', e => {
    if (['INPUT', 'BUTTON'].includes(e.target.tagName) ||
        e.target.classList.contains('port-dot') ||
        e.target.tagName === 'LABEL') return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    down = true; dragging = false;
    startX = e.clientX; startY = e.clientY;
    elStartX = parseFloat(el.style.left) || 0;
    elStartY = parseFloat(el.style.top)  || 0;

    try { el.setPointerCapture(e.pointerId); captured = true; } catch (err) { captured = false; }

    lpTimer = setTimeout(() => {
      if (down && !dragging) {
        el.classList.add('long-press');
        setTimeout(() => removeModule(id), 150);
      }
    }, LONG_PRESS_MS);

    e.preventDefault();
  });

  el.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging && (Math.abs(dx) > LONG_PRESS_MOVE || Math.abs(dy) > LONG_PRESS_MOVE)) {
      dragging = true;
      el.classList.add('dragging');
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    }
    if (!dragging) return;
    const s = view.scale || 1;
    el.style.left = Math.max(0, elStartX + dx / s) + 'px';
    el.style.top  = Math.max(0, elStartY + dy / s) + 'px';
    redrawCables();
  });

  const end = (e) => {
    if (!down) return;
    down = false;
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    el.classList.remove('dragging');
    if (captured) { try { el.releasePointerCapture(e.pointerId); } catch (err) {} captured = false; }
    dragging = false;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// ---- Cable drawing ----
function redrawCables() {
  const svg = document.getElementById('svg-layer');
  const wrap = document.getElementById('canvas-wrap');
  // size SVG large enough to cover any zoomed/panned position; transform on parent scales it
  svg.setAttribute('width',  Math.max(wrap.offsetWidth,  4000));
  svg.setAttribute('height', Math.max(wrap.offsetHeight, 4000));
  svg.innerHTML = '';
  cables.forEach(c => {
    const a = getDotPos(c.fromId, c.fromPort, 'out');
    const b = getDotPos(c.toId, c.toPort, 'in');
    if (!a || !b) return;
    const dx = Math.abs(b.x - a.x) * 0.45;
    const droop = 30 + Math.abs(b.y - a.y) * 0.2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${a.x},${a.y} C${a.x+dx},${a.y+droop} ${b.x-dx},${b.y+droop} ${b.x},${b.y}`);
    path.setAttribute('stroke', c.color);
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('opacity', '0.9');
    svg.appendChild(path);
  });
}

// dot position in canvas (pre-transform) coordinates
function getDotPos(id, port, dir) {
  const m = mods[id]; if (!m) return null;
  const actualDir = (port === 'pitch-out' || port === 'mod-out') ? 'out' : dir;
  const dot = m.el.querySelector(`.port-dot[data-port="${port}"][data-dir="${actualDir}"]`);
  if (!dot) return null;
  const content = document.getElementById('canvas-content');
  const cRect = content.getBoundingClientRect();
  const r = dot.getBoundingClientRect();
  const s = view.scale || 1;
  return {
    x: (r.left - cRect.left) / s + r.width  / (2 * s),
    y: (r.top  - cRect.top)  / s + r.height / (2 * s)
  };
}

// ---- Envelope (VCA) module ----
function addEnv(x, y) {
  const id = uid();
  x = x || rp(); y = y || rp(80);
  const envGain = AC.createGain();
  envGain.gain.value = 0;
  const desc = {
    type: 'env', envGain,
    attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3,
    audioIn: envGain, audioOut: envGain,
    modIn: null, rateModIn: null, modOut: null
  };
  spawnModule(id, desc, `
    <div class="mod-title">Env (VCA)</div>
    <canvas id="${id}-canvas" class="env-indicator" width="110" height="28"></canvas>
    <div class="mod-knob"><label>attack</label>
      <input type="range" min="0.001" max="2" value="0.01" step="0.001"
        oninput="mods['${id}'].attack=+this.value;this.nextElementSibling.textContent=parseFloat(this.value).toFixed(3)+'s';drawEnvShape('${id}')">
      <span>0.010s</span></div>
    <div class="mod-knob"><label>decay</label>
      <input type="range" min="0.001" max="2" value="0.1" step="0.001"
        oninput="mods['${id}'].decay=+this.value;this.nextElementSibling.textContent=parseFloat(this.value).toFixed(3)+'s';drawEnvShape('${id}')">
      <span>0.100s</span></div>
    <div class="mod-knob"><label>sustain</label>
      <input type="range" min="0" max="1" value="0.7" step="0.01"
        oninput="mods['${id}'].sustain=+this.value;this.nextElementSibling.textContent=parseFloat(this.value).toFixed(2);drawEnvShape('${id}')">
      <span>0.70</span></div>
    <div class="mod-knob"><label>release</label>
      <input type="range" min="0.001" max="3" value="0.3" step="0.001"
        oninput="mods['${id}'].release=+this.value;this.nextElementSibling.textContent=parseFloat(this.value).toFixed(3)+'s';drawEnvShape('${id}')">
      <span>0.300s</span></div>
    <div class="ports">
      <div class="port-col">${portH(id, 'in', 'in', 'in')}</div>
      <div class="port-col outputs">${portH(id, 'out', 'out', 'out')}</div>
    </div>`, x, y, 'env-mod');
  setTimeout(() => drawEnvShape(id), 50);
}

function drawEnvShape(id) {
  const m = mods[id]; if (!m) return;
  const canvas = document.getElementById(id + '-canvas'); if (!canvas) return;
  const W = canvas.offsetWidth || 110, H = 28;
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, W, H);
  const total = m.attack + m.decay + 0.3 + m.release;
  const ax = m.attack/total*W, dx = ax + m.decay/total*W;
  const sx = dx + 0.3/total*W, ex = W;
  c.strokeStyle = '#185FA5'; c.lineWidth = 1.5; c.beginPath();
  c.moveTo(0, H); c.lineTo(ax, 2);
  c.lineTo(dx, H - (m.sustain * (H - 4)) - 2);
  c.lineTo(sx, H - (m.sustain * (H - 4)) - 2);
  c.lineTo(ex, H);
  c.stroke();
}

function envNoteOn(id) {
  const m = mods[id]; if (!m) return;
  const g = m.envGain.gain, t = AC.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(1, t + m.attack);
  g.linearRampToValueAtTime(m.sustain, t + m.attack + m.decay);
}

function envNoteOff(id) {
  const m = mods[id]; if (!m) return;
  const g = m.envGain.gain, t = AC.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(0, t + m.release);
}

function triggerEnvOn()  { Object.entries(mods).forEach(([id, m]) => { if (m.type === 'env') envNoteOn(id);  }); }
function triggerEnvOff() { Object.entries(mods).forEach(([id, m]) => { if (m.type === 'env') envNoteOff(id); }); }

// ---- Drone module ----
function addDrone(x, y) {
  const id = uid();
  x = x || rp(); y = y || rp(80);
  const desc = {
    type: 'drone', on: false, heldNotes: new Set(),
    audioIn: null, audioOut: null, modIn: null, rateModIn: null, modOut: null
  };
  spawnModule(id, desc, `
    <div class="mod-title">
      <span>Drone</span>
      <label class="mod-on"><input type="checkbox" onchange="toggleDrone('${id}',this.checked)"> on</label>
    </div>
    <div class="drone-notes" id="${id}-notes">—</div>
    <div style="font-size:9px;color:#555;margin-top:4px;">hold notes → toggle off to release</div>
  `, x, y, 'drone-mod');
}

function toggleDrone(id, on) {
  const m = mods[id]; m.on = on;
  if (!on) {
    m.heldNotes.forEach(midi => highlightKey(midi, false));
    triggerEnvOff();
    m.heldNotes.clear();
    document.getElementById(id + '-notes').textContent = '—';
  }
}

// ---- Notes ----
function noteOn(midi) {
  if (AC.state === 'suspended') AC.resume();

  const droneActive = Object.values(mods).some(m => m.type === 'drone' && m.on);
  if (droneActive) {
    Object.entries(mods).forEach(([id, m]) => {
      if (m.type !== 'drone' || !m.on || m.heldNotes.has(midi)) return;
      m.heldNotes.add(midi);
      Object.values(mods).forEach(mod => {
        if (mod.type === 'osc') { mod.currentMidi = midi; mod.osc.frequency.value = midiToFreq(midi + (mod.octave || 0) * 12); }
      });
      triggerEnvOn();
      highlightKey(midi, true, 'held');
      document.getElementById(id + '-notes').textContent = Array.from(m.heldNotes).map(noteName).join(' ');
    });
    return;
  }

  const arpActive = Object.values(mods).some(m => m.type === 'arp' && m.on);
  if (arpActive) {
    Object.values(mods).forEach(m => { if (m.type === 'arp') { m.heldKeys.add(midi); highlightKey(midi, true, 'held'); } });
    return;
  }

  Object.values(mods).forEach(m => {
    if (m.type === 'osc') { m.currentMidi = midi; m.osc.frequency.value = midiToFreq(midi + (m.octave || 0) * 12); }
  });
  triggerEnvOn();
  highlightKey(midi, true, 'on');
}

function noteOff(midi) {
  if (Object.values(mods).some(m => m.type === 'drone' && m.on)) return;

  const arpActive = Object.values(mods).some(m => m.type === 'arp' && m.on);
  if (arpActive) {
    Object.values(mods).forEach(m => { if (m.type === 'arp') m.heldKeys.delete(midi); });
    highlightKey(midi, false);
    return;
  }

  triggerEnvOff();
  highlightKey(midi, false);
}

function highlightKey(midi, on, cls = 'on') {
  const el = document.querySelector(`[data-midi="${midi}"]`); if (!el) return;
  el.classList.remove('on', 'held');
  if (on) el.classList.add(cls);
}

// ---- Canvas pan + zoom gestures ----
function initCanvasGestures() {
  const wrap = document.getElementById('canvas-wrap');
  const pointers = new Map(); // pointerId → { x, y }
  let panLast = null;
  let pinchPrev = null; // { dist, cx, cy }

  wrap.addEventListener('pointerdown', e => {
    // ignore if pointer started on a module / control
    if (e.target.closest('.module')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { wrap.setPointerCapture(e.pointerId); } catch (err) {}

    if (pointers.size === 1) {
      panLast = { x: e.clientX, y: e.clientY };
      pinchPrev = null;
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchPrev = pinchState(pts[0], pts[1]);
      panLast = null;
    }
    e.preventDefault();
  });

  wrap.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1 && panLast) {
      view.tx += e.clientX - panLast.x;
      view.ty += e.clientY - panLast.y;
      panLast = { x: e.clientX, y: e.clientY };
      applyView();
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const cur = pinchState(pts[0], pts[1]);
      if (pinchPrev && pinchPrev.dist > 0) {
        const factor = cur.dist / pinchPrev.dist;
        zoomAt(cur.cx, cur.cy, factor);
      }
      pinchPrev = cur;
    }
  });

  const endPointer = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchPrev = null;
    if (pointers.size === 0) panLast = null;
    if (pointers.size === 1) {
      const last = [...pointers.values()][0];
      panLast = { x: last.x, y: last.y };
    }
    try { wrap.releasePointerCapture(e.pointerId); } catch (err) {}
  };
  wrap.addEventListener('pointerup', endPointer);
  wrap.addEventListener('pointercancel', endPointer);

  wrap.addEventListener('wheel', e => {
    if (e.target.closest('.module')) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });
}

function pinchState(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return { dist: Math.hypot(dx, dy), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}

function zoomAt(clientX, clientY, factor) {
  const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();
  const px = clientX - wrap.left;
  const py = clientY - wrap.top;
  const newScale = Math.min(2.5, Math.max(0.3, view.scale * factor));
  const realFactor = newScale / view.scale;
  view.tx = px - (px - view.tx) * realFactor;
  view.ty = py - (py - view.ty) * realFactor;
  view.scale = newScale;
  applyView();
}

// ---- Computer keyboard ----
const KEY_MAP = { a:0,w:1,s:2,e:3,d:4,f:5,t:6,g:7,y:8,h:9,u:10,j:11,k:12,o:13,l:14 };
const BASE = 48;
const pressed = new Set();

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k in KEY_MAP && !pressed.has(k)) { pressed.add(k); noteOn(BASE + KEY_MAP[k]); }
});
document.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (k in KEY_MAP) { pressed.delete(k); noteOff(BASE + KEY_MAP[k]); }
});

// ---- Pointer piano (multitouch) ----
const pianoPointers = new Map(); // pointerId → midi

function attachKey(el, midi) {
  el.addEventListener('pointerdown', e => {
    e.stopPropagation();
    e.preventDefault();
    pianoPointers.set(e.pointerId, midi);
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    noteOn(midi);
  });
  const release = e => {
    const m = pianoPointers.get(e.pointerId);
    if (m == null) return;
    pianoPointers.delete(e.pointerId);
    try { el.releasePointerCapture(e.pointerId); } catch (err) {}
    noteOff(m);
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', e => {
    // only release if pointer is up (touch/mouse leaving while held shouldn't release on captured)
    if (!pianoPointers.has(e.pointerId)) return;
    if (e.buttons === 0 && e.pointerType === 'mouse') release(e);
  });
}

function buildPiano() {
  const piano = document.getElementById('piano');
  const s = 3, o = 3, wp = [0, 2, 4, 5, 7, 9, 11];
  for (let oct = 0; oct < o; oct++) {
    wp.forEach(semi => {
      const midi = (s + oct) * 12 + semi;
      const k = document.createElement('div');
      k.className = 'wk'; k.dataset.midi = midi;
      attachKey(k, midi);
      piano.appendChild(k);
    });
  }
  const bk = document.createElement('div'); bk.className = 'bks';
  const kw = 100 / (o * 7);
  for (let oct = 0; oct < o; oct++) {
    [[0.7,1],[1.7,3],[3.7,6],[4.7,8],[5.7,10]].forEach(([off, semi]) => {
      const midi = (s + oct) * 12 + semi;
      const k = document.createElement('div');
      k.className = 'bk'; k.dataset.midi = midi;
      k.style.cssText = `left:${((oct*7)+off)*kw}%;width:${kw*0.6}%;height:100%`;
      attachKey(k, midi);
      bk.appendChild(k);
    });
  }
  piano.appendChild(bk);
}

// ---- Init ----
applyView();
initCanvasGestures();
buildPiano();
addOsc(20, 20);
addOsc(170, 20);
addFilter(320, 20);
addEnv(470, 20);
addOutput(630, 20);
addLfo(20, 290);
addArp(170, 290);
addDrone(400, 310);
