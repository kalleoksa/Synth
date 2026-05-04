# Digital Moog Matriarch — Implementation Plan

Browser-based digital recreation of the Moog Matriarch semi-modular synthesizer,
built on the existing modular patch bay architecture (Web Audio API + JS).

-----

## Reference: Matriarch signal flow (default, no patching)

```
VCO 1-4 + Noise
      ↓
   Mixer (CP3)
      ↓
 Dual Filter (LP + HP, series/parallel/stereo)
      ↓
  VCA 1 (L) ←── EG 1
  VCA 2 (R) ←── EG 2
      ↓
 Delay L / Delay R
      ↓
   Output L / R
```

Modulation sources (LFO 1, LFO 2, EG 1, EG 2, attenuators) patch into
any CV input via the patch bay — no hardwired mod routing.

-----

## Modules to build

### Phase 1 — Sound sources & mixing

#### 1.1 Noise module

- White noise via `AudioBufferSourceNode` (fill buffer with `Math.random()*2-1`)
- Single output port
- Level knob
- **Ports:** `out`

#### 1.2 Mixer module (CP3-style)

- 6 input channels, each with a level knob
- Summing `GainNode` into a `WaveShaper` for asymmetric soft clipping
  (models the CP3's overdrive character at high levels)
- Master level knob
- **Ports:** `in-1` through `in-6`, `out`

-----

### Phase 2 — Dual filter

#### 2.1 Filter module (dual LP/HP)

- Two `BiquadFilterNode`s: one lowpass, one highpass
- Mode switch with three settings:
  - **Series HP→LP** — HP output feeds LP input (mono, bandpass-like)
  - **Parallel HP/LP** — both receive same input, outputs summed (band-reject / formant)
  - **Stereo LP/LP** — both are lowpass, LP1 → L channel, LP2 → R channel
- Controls: cutoff (shared), spacing (offset between filter frequencies), resonance ×2
- **Ports:** `in`, `mod` (cutoff CV), `hp-out`, `lp-out`, `out` (mixed)

Implementation note: mode switch rewires the internal Web Audio graph on change.

-----

### Phase 3 — Stereo VCA + stereo output

#### 3.1 VCA module (stereo pair)

- Two independent `GainNode`s (VCA 1 = L, VCA 2 = R)
- Mode switch per VCA: **ENV** (gain driven by EG), **Drone** (open), **Split** (EG1→L, EG2→R)
- **Ports:** `in-l`, `in-r`, `cv-l`, `cv-r`, `out-l`, `out-r`

#### 3.2 Stereo Output module (replaces current mono Output)

- Two input channels (L/R) → `AudioContext.destination` via stereo merger
- Master volume, pan trim
- **Ports:** `in-l`, `in-r`

-----

### Phase 4 — Effects

#### 4.1 Stereo Delay module

- Two `DelayNode`s with feedback loops
- Mode switch: **Stereo** (L and R independent) / **Ping-pong** (L delay feeds R, R feeds L)
- Controls: time (35–780ms), feedback, mix (dry/wet)
- Time CV input for modulation
- **Ports:** `in-l`, `in-r`, `time-mod`, `out-l`, `out-r`

Implementation note: ping-pong achieved by cross-patching feedback paths.

-----

### Phase 5 — Modulation utilities

#### 5.1 LFO 2 module

- Simpler than LFO 1: triangle + square outputs only (like the Matriarch secondary LFO)
- Rate knob + rate CV input
- Rate range: 0.07–520 Hz
- **Ports:** `rate-mod`, `tri-out`, `sq-out`

#### 5.2 Bipolar Attenuator module (×3, or one module with 3 channels)

- `GainNode` with gain range -1 to +1
- At negative gain = signal inversion (enables -ENV trick from the manual)
- At gain = 0 with two inputs = ring modulator behaviour
- **Ports per channel:** `in`, `out`

#### 5.3 Multiple module (passive 1→4 splitter)

- No audio processing — one input fans to 4 outputs in the patch bay
- Pure routing utility
- **Ports:** `in`, `out-1` through `out-4`

Implementation note: connect `audioOut` of source to all four destination `audioIn`s.

-----

### Phase 6 — Paraphony (largest architectural change)

Currently all OSC modules share a single frequency driven by the last played note.
Paraphony requires independent pitch-per-oscillator voice allocation.

#### Voice allocation modes

- **Mono** — all 4 OSCs play the same pitch (current behaviour)
- **Duo** — OSC 1+2 play note 1, OSC 3+4 play note 2
- **Quad** — each OSC plays an independent note (4-note paraphony)

#### Implementation approach

- Add a **Voice Router** module that receives MIDI/keyboard input
- Maintains a `voiceMap`: `{ voice1: midi, voice2: midi, voice3: midi, voice4: midi }`
- Distributes pitch CVs to OSC modules tagged as voice 1–4
- OSC modules get a `voiceSlot` property; Voice Router sets frequency per slot
- Mode switch on Voice Router controls allocation logic

#### Changes required to existing code

- `noteOn` / `noteOff` currently iterate all OSC modules and set same frequency
- Needs to become voice-aware: route by `voiceSlot` when Voice Router exists
- Envelope triggering also needs per-voice logic in duo/quad modes

-----

### Phase 7 — Step Sequencer

#### 7.1 Sequencer module

- Up to 16 steps (expandable to 32/64), up to 4 notes per step (for paraphony)
- Controls: steps count, rate (BPM or Hz), direction (forward/backward/random)
- Per-step: pitch, gate length, active toggle
- Clock sync: internal or external clock input
- **Ports:** `clock-in`, `clock-out`, `pitch-out-1` through `pitch-out-4`, `gate-out`

Implementation note: extend the existing ARP `setInterval` clock approach.
Pitch outputs drive OSC frequencies the same way the ARP does.

-----

## File structure

```
/
├── index.html
├── style.css
├── synth.js              ← existing core (patch bay, cable routing, piano)
├── modules/
│   ├── osc.js            ← existing, extend with voiceSlot
│   ├── filter.js         ← replace with dual filter
│   ├── env.js            ← existing
│   ├── vca.js            ← new stereo VCA
│   ├── lfo.js            ← existing, keep as LFO 1
│   ├── lfo2.js           ← new simpler LFO
│   ├── arp.js            ← existing
│   ├── drone.js          ← existing
│   ├── noise.js          ← new
│   ├── mixer.js          ← new CP3-style
│   ├── delay.js          ← new stereo delay
│   ├── attenuator.js     ← new bipolar attenuator
│   ├── multiple.js       ← new passive splitter
│   ├── voice-router.js   ← new paraphony voice allocation
│   ├── sequencer.js      ← new step sequencer
│   └── output.js         ← replace with stereo output
└── MATRIARCH_PLAN.md
```

Refactor `synth.js` to import from `modules/` once more than ~3 modules exist.

-----

## Build order

| Phase | Module(s)                     | Complexity | Depends on         |
|-------|-------------------------------|------------|--------------------|
| 1     | Noise, Mixer                  | Low        | —                  |
| 2     | Dual Filter                   | Medium     | Mixer              |
| 3     | Stereo VCA, Stereo Output     | Medium     | Dual Filter        |
| 4     | Stereo Delay                  | Medium     | Stereo VCA         |
| 5     | LFO 2, Attenuators, Multiple  | Low        | —                  |
| 6     | Voice Router + paraphony      | High       | All OSC/EG modules |
| 7     | Step Sequencer                | Medium     | Voice Router       |

-----

## Web Audio API mapping

| Matriarch hardware        | Web Audio node                                    |
|---------------------------|---------------------------------------------------|
| VCO (Moog 921)            | `OscillatorNode`                                  |
| White noise               | `AudioBufferSourceNode`                           |
| Mixer CP3                 | `GainNode` × N → `WaveShaper`                     |
| Ladder filter (Moog 904a) | `BiquadFilterNode` (lowpass/highpass)             |
| VCA (Moog 902)            | `GainNode`                                        |
| BBD Stereo Delay          | `DelayNode` × 2 + feedback `GainNode`             |
| ADSR EG (Moog 911)        | `GainNode` with scheduled `AudioParam` ramps      |
| LFO / Mod Oscillator      | `OscillatorNode` at low frequency                 |
| Bipolar attenuator        | `GainNode` (gain: -1 to +1)                       |
| Stereo merger             | `ChannelMergerNode`                               |
| Ring modulator            | Two `GainNode`s cross-connected (or `WaveShaper`) |

-----

## Notes

- Paraphony is the biggest structural change — do it last when the rest is stable
- The dual filter's stereo mode splits mono into L/R, requiring `ChannelSplitterNode`
  and `ChannelMergerNode` around the filter section
- Ping-pong delay: route L delay output → R delay input and vice versa via feedback nodes
- The CP3 mixer's overdrive is a `WaveShaper` with a gentle asymmetric curve —
  same approach as the overdrive module but softer and pre-filter
- S&H and stepped triangle on LFO 1 stay as `requestAnimationFrame` (not native Web Audio)
