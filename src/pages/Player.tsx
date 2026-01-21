import React, { useEffect, useRef, useState } from 'react';
// import { useNavigate } from 'react-router-dom';
import { Midi } from '@tonejs/midi';
import * as Tone from 'tone';
import { Piano } from 'react-piano';
import 'react-piano/dist/styles.css';
import './Player.css';

// --- Types ---
interface PlayerProps {
  file: File | null;
  onSelectFile: (file: File) => void;
}

interface NoteData {
  midi: number;
  name: string;
  time: number;
  ticks: number;     // Added
  duration: number;
  durationTicks: number; // Added
  velocity: number;
  trackIndex: number; 
}

interface KeyConfig {
  midi: number;
  note: string;
  type: 'white' | 'black';
  left: number; 
  width: number; 
  activeColor?: string;
}

// --- Constants ---
const NOTES_VISIBLE_DURATION = 3.0; 
const DEFAULT_PIANO_RANGE = { min: 21, max: 108 };
const STORAGE_KEY_DATA = 'midi_data_b64';
const STORAGE_KEY_NAME = 'midi_name';

// --- React Piano Config ---
// Matches react-piano/src/MidiNumbers.js & Keyboard.js
const PITCH_POSITIONS: Record<number, number> = {
  0: 0,     // C
  1: 0.55,  // C# (Db)
  2: 1,     // D
  3: 1.8,   // D# (Eb)
  4: 2,     // E
  5: 3,     // F
  6: 3.5,   // F# (Gb)
  7: 4,     // G
  8: 4.7,   // G# (Ab)
  9: 5,     // A
  10: 5.85, // A# (Bb)
  11: 6     // B
};
const ACCIDENTAL_WIDTH_RATIO = 0.65;

// --- Helpers for Storage ---
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

// --- Helper Functions ---
function getMidiAttribute(midiNumber: number) {
   const offset = midiNumber - 12; // MIDI 12 is C0 in react-piano world (usually)
   // Actually react-piano defines MIN_MIDI_NUMBER = 12 (C0).
   // But standard MIDI 21 is A0.
   // Let's stick to standard MIDI indices for octave calc:
   // MIDI 0 = C-1. 12 = C0.
   const octave = Math.floor(offset / 12);
   const pitchIndex = offset % 12; // 0..11
   return { octave, pitchIndex };
}

function getAbsoluteKeyPosition(midiNumber: number) {
   const OCTAVE_WIDTH = 7;
   // We need to match react-piano logic exactly.
   // react-piano uses (midiNumber - 12) logic.
   // if midi < 12 it might break or behave differently if we strictly follow their code 
   // but normally we are > 21.
   const { octave, pitchIndex } = getMidiAttribute(midiNumber);
   const pitchPos = PITCH_POSITIONS[pitchIndex];
   return (octave * OCTAVE_WIDTH) + pitchPos;
}

const generateKeyboardConfig = (min: number, max: number): KeyConfig[] => {
  const config: KeyConfig[] = [];
  
  // 1. Calculate White Key Count for Width Ratio
  let whiteKeyCount = 0;
  for (let i = min; i <= max; i++) {
    const noteIndex = i % 12;
    const isBlack = [1, 3, 6, 8, 10].includes(noteIndex);
    if (!isBlack) whiteKeyCount++;
  }

  const whiteKeyWidth = 100 / whiteKeyCount; 
  // const blackKeyWidth = whiteKeyWidth * 0.7; // OLD
  
  const startAbsolutePos = getAbsoluteKeyPosition(min);

  for (let i = min; i <= max; i++) {
    const noteIndex = i % 12;
    // MIDI 0 = C-1.
    // 0=C, 1=C#, 2=D, 3=D#, 4=E, 5=F, 6=F#, 7=G, 8=G#, 9=A, 10=A#, 11=B
    const isBlack = [1, 3, 6, 8, 10].includes(noteIndex);
    
    // Note Name Calculation
    const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const octave = Math.floor(i / 12) - 1;
    const noteName = noteNames[noteIndex] + octave;

    const absolutePos = getAbsoluteKeyPosition(i);
    const relativePos = absolutePos - startAbsolutePos;
    
    const leftPercent = relativePos * whiteKeyWidth;

    if (!isBlack) {
        config.push({
            midi: i,
            note: noteName,
            type: 'white',
            left: leftPercent, 
            width: whiteKeyWidth
        });
    } else {
        const blkWidth = whiteKeyWidth * ACCIDENTAL_WIDTH_RATIO;
        config.push({
            midi: i,
            note: noteName,
            type: 'black',
            left: leftPercent, // React-piano uses strict relative pos left for black keys too
            width: blkWidth
        });
    }
  }
  return config;
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const Player: React.FC<PlayerProps> = ({ file, onSelectFile }) => {
  // const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeKeys, setActiveKeys] = useState<Set<number>>(new Set());
  const [songTitle, setSongTitle] = useState("Loading...");
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [hasUserStarted, setHasUserStarted] = useState(false);
  const [containerWidth, setContainerWidth] = useState(1000); // Default fallback
  const [activeRange, setActiveRange] = useState(DEFAULT_PIANO_RANGE);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [baseBpm, setBaseBpm] = useState(120);
  const [totalTicks, setTotalTicks] = useState(0);

  // Memoize keyboard config to ensure it's stable and correct
  const keyboardConfig = React.useMemo(() => generateKeyboardConfig(activeRange.min, activeRange.max), [activeRange]);
  
  // Optimization: Create a Map for fast O(1) key lookups
  const keyConfigMap = React.useMemo(() => {
      const map = new Map<number, KeyConfig>();
      keyboardConfig.forEach(k => map.set(k.midi, k));
      return map;
  }, [keyboardConfig]);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const notesRef = useRef<NoteData[]>([]);
  const activeKeysRef = useRef<Set<number>>(new Set());
  const samplerRef = useRef<Tone.Sampler | null>(null);
  const animationFrameRef = useRef<number>(0);
  const searchIndexRef = useRef<number>(0); // Optimization for loop start
  const lastTimeRef = useRef<number>(0); // Track time to detect seeks
  const scrubberRef = useRef<HTMLInputElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);

  const handleStart = async () => {
    try {
      await Tone.start();
      setHasUserStarted(true);
    } catch (e) {
      console.error("Tone.start failed", e);
      setLoadingError("Could not start audio engine.");
    }
  };

  useEffect(() => {
    let mounted = true;
    if (!hasUserStarted) return;

    const init = async () => {
      // 1. Setup Audio
      // Tone.start() was already called in handleStart
      
      const sampler = new Tone.Sampler({
        urls: {
          A0: "A0.mp3",
          C1: "C1.mp3",
          "D#1": "Ds1.mp3",
          "F#1": "Fs1.mp3",
          A1: "A1.mp3",
          C2: "C2.mp3",
          "D#2": "Ds2.mp3",
          "F#2": "Fs2.mp3",
          A2: "A2.mp3",
          C3: "C3.mp3",
          "D#3": "Ds3.mp3",
          "F#3": "Fs3.mp3",
          A3: "A3.mp3",
          C4: "C4.mp3",
          "D#4": "Ds4.mp3",
          "F#4": "Fs4.mp3",
          A4: "A4.mp3",
          C5: "C5.mp3",
          "D#5": "Ds5.mp3",
          "F#5": "Fs5.mp3",
          A5: "A5.mp3",
          C6: "C6.mp3",
          "D#6": "Ds6.mp3",
          "F#6": "Fs6.mp3",
          A6: "A6.mp3",
          C7: "C7.mp3",
          "D#7": "Ds7.mp3",
          "F#7": "Fs7.mp3",
          A7: "A7.mp3",
          C8: "C8.mp3"
        },
        release: 1,
        baseUrl: "https://tonejs.github.io/audio/salamander/",
        onerror: (err) => {
            console.warn("Sampler error (continuing anyway):", err);
        }
      }).toDestination();
      
      try {
        await Tone.loaded();
      } catch (err) {
        console.warn("Some samples failed to load, continuing...", err);
      }
      
      samplerRef.current = sampler;

      if (!mounted) return;

      // 2. Load MIDI Logic
      const loadMidiData = async () => {
         try {
           let arrayBuffer: ArrayBuffer | null = null;
           let name = "";

           if (file) {
             const buffer = await file.arrayBuffer();
             arrayBuffer = buffer;
             name = file.name.replace('.mid', '').replace('.midi', '');
             // Save to storage
             try {
                localStorage.setItem(STORAGE_KEY_NAME, name);
                localStorage.setItem(STORAGE_KEY_DATA, arrayBufferToBase64(buffer));
             } catch (e) {
                console.warn("Quota exceeded, could not save to localStorage", e);
             }
           } else {
             // Check Local Storage
             const storedData = localStorage.getItem(STORAGE_KEY_DATA);
             const storedName = localStorage.getItem(STORAGE_KEY_NAME);
             
             if (storedData && storedName) {
                arrayBuffer = base64ToArrayBuffer(storedData);
                name = storedName;
             } else {
                // No file found at all
                throw new Error("No MIDI file found. Please upload one.");
             }
           }
           
           if (!arrayBuffer) throw new Error("Buffer is empty");

           const midi = new Midi(arrayBuffer);
           
           if (!mounted) return;

           setSongTitle(name);
           setDuration(midi.duration);
           
           // Ticks & BPM Setup
           const ppq = midi.header.ppq || 192; // Default to 192 if missing
           Tone.Transport.PPQ = ppq;
           const initialBpm = midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120;
           setBaseBpm(initialBpm);
           Tone.Transport.bpm.value = initialBpm;
           
           // Calculate total ticks (approximate if not present)
           // midi.durationTicks represents the end of the last note usually
           const lastNoteTick = Math.max(...midi.tracks.flatMap(t => t.notes.map(n => n.ticks + n.durationTicks)));
           setTotalTicks(lastNoteTick || (midi.duration * (initialBpm / 60) * ppq));

           // 3. Parse Notes
           const parsedNotes: NoteData[] = [];
           let minMidi = 108;
           let maxMidi = 21;

           midi.tracks.forEach((track, index) => {
             track.notes.forEach(note => {
               if (note.midi < minMidi) minMidi = note.midi;
               if (note.midi > maxMidi) maxMidi = note.midi;
               
               parsedNotes.push({
                 midi: note.midi,
                 name: note.name,
                 time: note.time,
                 ticks: note.ticks,
                 duration: note.duration,
                 durationTicks: note.durationTicks,
                 velocity: note.velocity,
                 trackIndex: index 
               });
             });
           });

           // Expand visible range slightly
           let newMin = Math.max(21, minMidi - 2);
           let newMax = Math.min(108, maxMidi + 2);
           
           // Helper to check black key
           const isBlack = (n: number) => [1, 3, 6, 8, 10].includes(n % 12);

           // Ensure boundaries are white keys for cleaner edges
           if (isBlack(newMin)) newMin = Math.max(21, newMin - 1);
           if (isBlack(newMax)) newMax = Math.min(108, newMax + 1);

           setActiveRange({ min: newMin, max: newMax });

           
           // Sort strictly by time for better performance in loop
           // Uses TIcks for sorting now to match render loop logic
           parsedNotes.sort((a, b) => a.ticks - b.ticks);

           notesRef.current = parsedNotes;
           searchIndexRef.current = 0; // Reset search index

           Tone.Transport.cancel();
           
           midi.tracks.forEach((track) => {
             track.notes.forEach((note) => {
               Tone.Transport.schedule((time) => {
                 sampler.triggerAttackRelease(note.name, note.duration, time, note.velocity);
               }, note.ticks + "i");
             });
           });

           setIsReady(true);
         } catch (e) {
           console.error("Failed to load MIDI", e);
           setLoadingError("Failed to parse MIDI file.");
         }
      };
      
      loadMidiData();
    };

    init();

    return () => {
      mounted = false;
      Tone.Transport.stop();
      Tone.Transport.cancel();
      if (samplerRef.current) samplerRef.current.dispose();
      cancelAnimationFrame(animationFrameRef.current!);
    };
  }, [file, hasUserStarted]); // Reload if file changes

  // --- Animation Loop ---
  useEffect(() => {
    if (!isReady || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleResize = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    const render = () => {
      // Use Ticks for synchronization instead of seconds to support variable BPM
      const currentTicks = Tone.Transport.ticks;
      
      // Map Ticks -> Projected "Song Seconds" for scrubber
      // This keeps the scrubber moving at a rate that matches the song's original duration
      // regardless of playback speed.
      const projectedTime = totalTicks > 0 ? (currentTicks / totalTicks) * duration : 0;
      
      if (scrubberRef.current) {
        scrubberRef.current.value = String(projectedTime);
      }
      if (timeDisplayRef.current) {
        const mins = Math.floor(projectedTime / 60);
        const secs = Math.floor(projectedTime % 60);
        timeDisplayRef.current.innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
      }
      
      // Automatic Reset on Backward Seek/Loop
      // If time jumped backwards by more than a small threshold, we reset search
      // Using ticks for check is safer
      const nowTicksStr = currentTicks;
      if (nowTicksStr < (lastTimeRef.current || 0)) {
           searchIndexRef.current = 0;
      }
      lastTimeRef.current = nowTicksStr;

      // Clear Screen
      // Optimization: Access ref once
      const canvas = canvasRef.current;
      if (!canvas) return; // Should not happen given outer check but safety first
      
      const width = canvas.offsetWidth; 
      const height = canvas.offsetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.clearRect(0, 0, width, height);
      
      // VISIBILITY CALCULATION
      // We need to know how many ticks represent 3.0 seconds RIGHT NOW.
      // Ticks per second = (BPM * PPQ) / 60
      const currentBpm = Tone.Transport.bpm.value;
      const ppq = Tone.Transport.PPQ;
      const ticksPerSecond = (currentBpm * ppq) / 60;
      const visibleTickRange = NOTES_VISIBLE_DURATION * ticksPerSecond;
      
      const pixelsPerTick = height / visibleTickRange;
      
      const currentActive = new Set<number>();
      
      // Batch Drawing Arrays
      const leftHandRects: [number, number, number, number][] = [];
      const rightHandRects: [number, number, number, number][] = [];

      // Loop Optimization
      let i = searchIndexRef.current;
      while (i < notesRef.current.length) {
         const note = notesRef.current[i];
         // Pruning: If note END is before current ticks (with 1s buffer converted to ticks approx)
         // Buffer = 1s * ticksPerSecond
         const bufferTicks = ticksPerSecond;
         if (note.ticks + note.durationTicks < currentTicks - bufferTicks) { 
             i++;
             searchIndexRef.current = i;
         } else {
             break;
         }
      }

      // Render Loop
      const notes = notesRef.current;
      const len = notes.length;

      for (let j = i; j < len; j++) {
        const note = notes[j];
        
        const ticksUntilHit = note.ticks - currentTicks;
        
        // VISIBILITY CULLING (Future)
        if (ticksUntilHit > visibleTickRange) {
             break; 
        }

        const ticksEndUntilHit = (note.ticks + note.durationTicks) - currentTicks;
        
        // VISIBILITY CULLING (Past)
        if (ticksEndUntilHit < 0) {
            continue; 
        }

        // Active Key Logic
        if (currentTicks >= note.ticks && currentTicks < (note.ticks + note.durationTicks)) {
             currentActive.add(note.midi);
        }

        // --- DRAWING CALCS ---
        const keyData = keyConfigMap.get(note.midi);
        if (!keyData) continue;

        const x = (keyData.left / 100) * width;
        const w = (keyData.width / 100) * width;
        
        // Calculate Y
        const bottomY = height - (ticksUntilHit * pixelsPerTick);
        const noteHeight = note.durationTicks * pixelsPerTick;
        const topY = bottomY - noteHeight;
        
        // Push to batches
        if (note.trackIndex > 0) {
           leftHandRects.push([x, topY, w, noteHeight - 1]);
        } else {
           rightHandRects.push([x, topY, w, noteHeight - 1]);
        }
      }

      // --- BATCH DRAW ---
      // Draw Left Hand (Blue)
      if (leftHandRects.length > 0) {
        ctx.fillStyle = '#38bdf8';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        for (const [x, y, w, h] of leftHandRects) {
           roundRect(ctx, x, y, w, h, 4);
        }
        ctx.fill();
      }

      // Draw Right Hand (Purple)
      if (rightHandRects.length > 0) {
        ctx.fillStyle = '#a78bfa';
        ctx.shadowColor = '#a78bfa';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        for (const [x, y, w, h] of rightHandRects) {
           roundRect(ctx, x, y, w, h, 4);
        }
        ctx.fill();
      }
      
      // Cleanup visual state
      ctx.shadowBlur = 0;

      // Sync Active Keys
      const prev = activeKeysRef.current;
      let changed = false;
      if (prev.size !== currentActive.size) changed = true;
      else {
          for (const k of currentActive) {
              if (!prev.has(k)) {
                  changed = true;
                  break;
              }
          }
      }

      if (changed) {
          activeKeysRef.current = currentActive;
          setActiveKeys(currentActive);
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameRef.current!);
    };
  }, [isReady, duration, keyConfigMap, totalTicks]);  

  // --- Keyboard Controls ---
  useEffect(() => {
    if (!isReady) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent default behavior for arrow keys to avoid page scrolling
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }

      switch (e.key) {
        case ' ': // Space bar - play/pause
          togglePlay();
          break;
        case 'ArrowLeft': // Left arrow - 5 seconds backward
          skipBackward();
          break;
        case 'ArrowRight': // Right arrow - 5 seconds forward
          skipForward();
          break;
        case 'ArrowUp': // Up arrow - increase speed
          setPlaybackSpeed(prev => {
            const newSpeed = Math.min(2.0, prev + 0.1);
            if (baseBpm) {
              Tone.Transport.bpm.value = baseBpm * newSpeed;
            }
            return newSpeed;
          });
          break;
        case 'ArrowDown': // Down arrow - decrease speed
          setPlaybackSpeed(prev => {
            const newSpeed = Math.max(0.5, prev - 0.1);
            if (baseBpm) {
              Tone.Transport.bpm.value = baseBpm * newSpeed;
            }
            return newSpeed;
          });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isReady, baseBpm]);

  // --- Handlers ---
  const togglePlay = () => {
    if (Tone.Transport.state === 'started') {
      Tone.Transport.pause();
      setIsPlaying(false);
    } else {
      Tone.Transport.start();
      setIsPlaying(true);
    }
  };

  const skipForward = () => {
    Tone.Transport.seconds += 5;
  };
  
  const skipBackward = () => {
    Tone.Transport.seconds = Math.max(0, Tone.Transport.seconds - 5);
  };
  
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const timeVal = parseFloat(e.target.value);
    
    if (totalTicks > 0 && duration > 0) {
        // Reverse project time -> ticks
        const ratio = timeVal / duration;
        const targetTick = ratio * totalTicks;
        // Schedule transport to tick
        // We use string 'i' to be precise with ticks
        const tickStr = Math.floor(targetTick) + "i";
        Tone.Transport.position = tickStr;
    } else {
        Tone.Transport.seconds = timeVal;
    }
    
    setCurrentTime(timeVal);
  };
  
  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const spd = parseFloat(e.target.value);
      setPlaybackSpeed(spd);
      if (baseBpm) {
          Tone.Transport.bpm.value = baseBpm * spd;
      }
  };

  /* const handleBack = () => {
    Tone.Transport.stop();
    navigate('/');
  }; */

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleUploadNew = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="player-container">
      <input 
        type="file" 
        ref={fileInputRef} 
        accept=".mid,.midi" 
        style={{ display: 'none' }} 
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            Tone.Transport.stop();
            setIsPlaying(false);
            setIsReady(false);
            setLoadingError(null);
            setCurrentTime(0);
            searchIndexRef.current = 0;
            onSelectFile(f);
          }
        }}
      />

      <div className="stage">
        <div className="waterfall-area">
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
        </div>

        <div className="keyboard-deck" ref={containerRef}>
            <Piano
              noteRange={{ first: activeRange.min, last: activeRange.max }}
              playNote={(midiNumber: number) => {
                // Play sound if clicked manually
                const noteName = Tone.Frequency(midiNumber, "midi").toNote();
                samplerRef.current?.triggerAttack(noteName);
                setActiveKeys(prev => new Set(prev).add(midiNumber));
              }}
              stopNote={(midiNumber: number) => {
                const noteName = Tone.Frequency(midiNumber, "midi").toNote();
                samplerRef.current?.triggerRelease(noteName);
                 setActiveKeys(prev => {
                   const s = new Set(prev);
                   s.delete(midiNumber);
                   return s;
                 });
              }}
              width={containerWidth}
              activeNotes={Array.from(activeKeys)}
              // Custom rendering could be added here if we wanted to match exact colors
              // but default react-piano styles should be fine given the user asked for it.
              // We might need to override CSS for dark mode look.
            />
        </div>
      </div>

      <div className="hud-trigger-area" />

      <div className="hud-header">
        <div className="song-title">
          <h1>{songTitle}</h1>
        </div>
        <div className="hud-group controls-wrapper" style={{ opacity: !isReady ? 0.3 : 1, pointerEvents: !isReady ? 'none' : 'auto' }}>
            <div className="controls-group">
              <button className="control-btn mini" onClick={skipBackward}>↺</button>
              <button className="control-btn primary mini" onClick={togglePlay}>
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button className="control-btn mini" onClick={skipForward}>↻</button>
              
              <div className="speed-control" style={{ marginLeft: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '500', width: '28px' }}>{playbackSpeed.toFixed(1)}x</span>
                  <input 
                      type="range" 
                      min="0.5" 
                      max="2.0" 
                      step="0.1" 
                      value={playbackSpeed}
                      onChange={handleSpeedChange}
                      style={{ width: '60px', height: '3px' }}
                  />
              </div>

              <div className="scrubber-compact">
                <span className="time-current" ref={timeDisplayRef}>{formatTime(currentTime)}</span>
                <input 
                  type="range" 
                  min={0} 
                  max={duration || 1} 
                  step={0.1}
                  defaultValue={0}
                  ref={scrubberRef}
                  onChange={handleSeek}
                  className="progress-track"
                  style={{ width: '200px' }}
                />
                <span className="time-total">{formatTime(duration)}</span>
              </div>
            </div>
        </div>
            
        <button 
          className="btn-icon" 
          onClick={handleUploadNew}
          title="Upload new MIDI file"
        >
          📁
        </button>
      </div>

      {!isReady && (
        <div className="loading-overlay" style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.9)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 100, color: 'white'
        }}>
          {!hasUserStarted ? (
            <div style={{ textAlign: 'center' }}>
              <h2>Ready to Play</h2>
              <p style={{ color: '#888', marginBottom: '20px' }}>Click below to initialize audio engine</p>
              <button 
                onClick={handleStart}
                style={{
                  padding: '12px 24px',
                  background: 'var(--accent-primary)',
                  border: 'none',
                  borderRadius: '24px',
                  color: 'white',
                  fontSize: '1.1rem',
                  cursor: 'pointer',
                  boxShadow: '0 0 20px rgba(59, 130, 246, 0.4)'
                }}
              >
                Start Player
              </button>
            </div>
          ) : loadingError ? (
            <div style={{ textAlign: 'center' }}>
              <h2 style={{color: '#ef4444'}}>Error</h2>
              <p>{loadingError}</p>
              
              <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <button 
                  onClick={() => window.location.reload()}
                  className="btn-icon"
                >
                  Reload
                </button>
                
                <button 
                  onClick={handleUploadNew}
                  className="btn-icon"
                  style={{ background: 'var(--accent-primary)', color: 'white' }}
                >
                  Upload MIDI File
                </button>
              </div>
            </div>
          ) : (
             <div style={{ textAlign: 'center' }}>
                <h2>Loading Sounds...</h2>
                <p style={{color: '#888'}}>Fetching Instruments & Parsing MIDI</p>
                <div style={{ marginTop: '20px', width: '40px', height: '40px', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <style>{`@keyframes spin {100% {transform: rotate(360deg); }}`}</style>
             </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Player;
