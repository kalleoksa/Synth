# Synth

Browser-based modular synthesizer prototype. Built with Web Audio API and Web MIDI API as a precursor to a JUCE/C++ AU plugin for Logic Pro.

## Running

Open `index.html` in Chrome or Edge. No build step, no dependencies.

> Web MIDI API requires Chrome or Edge. Firefox and Safari have limited or no support.

## How to use

### Patching
1. Click an **output port** (right side of a module) — it turns amber
2. Click an **input port** (left side) to complete the cable
3. Click the same output again to cancel
4. Use **clear cables** to remove all connections

### Basic signal path
```
OSC out → Filter in → Filter out → Output in
```

### With modulation
```
LFO out → Filter mod
ARP mod cv → Filter mod  (steps filter cutoff per arp note)
ARP mod cv → LFO rate    (steps LFO rate per arp note)
```

### Arpeggiator
- Enable the ARP module with the **on** checkbox
- Hold keys on the piano or computer keyboard to build the sequence
- **UP / DN / UD** — direction
- **rate** — steps per second
- **gate** — note length within each step
- **octaves** — extends sequence across multiple octaves
- **mod depth** — scales the mod CV output

### Computer keyboard
```
A W S E D F T G Y H U J K
C C#D D#E F F#G G#A A#B C
```
Two octaves from C3.

## Modules

| Module | Inputs | Outputs | Notes |
|--------|--------|---------|-------|
| OSC | mod (detune) | out | SAW/SQR/SIN/TRI, detune, octave, level |
| Filter LP | in, mod (cutoff) | out | Cutoff, resonance |
| LFO | rate (rate mod) | out | SIN/TRI/SQR, rate, depth |
| ARP | — | pitch, mod cv | Drives OSC freq via JS; mod cv is a ConstantSource |
| Output | in | — | Final sink → master gain |

## Architecture

The Web Audio API node graph maps directly to JUCE's audio graph:

| Web Audio | JUCE equivalent |
|-----------|----------------|
| `OscillatorNode` | `juce::dsp::Oscillator` |
| `BiquadFilterNode` | `juce::dsp::IIR::Filter` |
| `GainNode` | `juce::dsp::Gain` |
| `ConstantSourceNode` | Custom parameter automation |
| `AudioParam.connect()` | AudioProcessorGraph connections |

The prototype is intentionally structured to validate DSP signal flow before porting to C++.

## Repo

[https://github.com/kalleoksa/Synth](https://github.com/kalleoksa/Synth)
