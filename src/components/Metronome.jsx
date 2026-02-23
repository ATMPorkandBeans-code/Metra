import { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';
import { unlockMobileAudio } from '../utils/mobileAudioUnlock';
import './Metronome.css';

// iOS audio unlock - plays a silent sound via HTML5 Audio to enable Web Audio through speakers
const unlockAudioForIOS = async () => {
  // Create a silent audio context buffer and play it
  const audioContext = Tone.getContext().rawContext;

  // Resume the audio context first
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  // Create and play a silent HTML5 Audio element
  // This "unlocks" audio on iOS and allows Web Audio to play through speakers
  const silentAudio = new Audio();
  silentAudio.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAAAwAAAbAAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV////////////////////////////////////////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQAAAAAAAAAAQGwNHHhTQAAAAAAAAAAAAAAAAD/4xjAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/jGMADwAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/jGMBAAAANIAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==';
  silentAudio.volume = 0.01;

  try {
    await silentAudio.play();
    silentAudio.pause();
    silentAudio.remove();
  } catch (e) {
    // Ignore errors - this is just a fallback unlock attempt
    console.log('iOS audio unlock attempted');
  }

  // Also play a silent Tone.js buffer to fully initialize the audio graph
  const buffer = audioContext.createBuffer(1, 1, 22050);
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.start(0);
};

// Generate polygon points for SVG
const getPolygonPoints = (sides, radius, centerX, centerY) => {
  const points = [];
  const angleOffset = -Math.PI / 2;

  for (let i = 0; i < sides; i++) {
    const angle = angleOffset + (2 * Math.PI * i) / sides;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    points.push({ x, y, angle });
  }
  return points;
};

// Interpolate position along polygon edge
const interpolatePosition = (points, progress) => {
  if (points.length === 0) return { x: 0, y: 0 };

  const totalSegments = points.length;
  const segmentProgress = progress * totalSegments;
  const currentSegment = Math.floor(segmentProgress) % totalSegments;
  const segmentT = segmentProgress - Math.floor(segmentProgress);

  const startPoint = points[currentSegment];
  const endPoint = points[(currentSegment + 1) % totalSegments];

  return {
    x: startPoint.x + (endPoint.x - startPoint.x) * segmentT,
    y: startPoint.y + (endPoint.y - startPoint.y) * segmentT,
  };
};

// Custom hook for pointerdown + drag to scrub value (works with mouse and touch)
const useScrollControl = (onChange, disabled) => {
  const elementRef = useRef(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const accumulatedDeltaRef = useRef(0);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const handlePointerDown = (e) => {
      if (disabled) return;
      e.preventDefault();
      isDraggingRef.current = true;
      startYRef.current = e.clientY;
      accumulatedDeltaRef.current = 0;
      element.classList.add('holding');
      element.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'ns-resize';
    };

    const handlePointerMove = (e) => {
      if (!isDraggingRef.current || disabled) return;

      const deltaY = startYRef.current - e.clientY;
      const threshold = 10;
      const totalDelta = accumulatedDeltaRef.current + deltaY;

      if (Math.abs(totalDelta) >= threshold) {
        const steps = Math.floor(totalDelta / threshold);
        onChange(steps);
        startYRef.current = e.clientY;
        accumulatedDeltaRef.current = totalDelta % threshold;
      }
    };

    const handlePointerUp = (e) => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        element.classList.remove('holding');
        element.releasePointerCapture(e.pointerId);
        document.body.style.cursor = '';
      }
    };

    element.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      element.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [onChange, disabled]);

  return elementRef;
};

const Metronome = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [beatActive, setBeatActive] = useState(false);
  const [timeSignature, setTimeSignature] = useState({ numerator: 4, denominator: 4 });
  const [currentBeat, setCurrentBeat] = useState(0);
  const [isDownbeat, setIsDownbeat] = useState(false);
  const [lightPosition, setLightPosition] = useState({ x: 210, y: 60 });
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState('blue');
  const [clickSound, setClickSound] = useState('normal');

  const synthRef = useRef(null);
  const accentSynthRef = useRef(null);
  const loopRef = useRef(null);
  const beatCountRef = useRef(0);
  const animationFrameRef = useRef(null);

  // SVG dimensions
  const svgSize = 420;
  const center = svgSize / 2;
  const shapeRadius = 150;
  const dotRadius = 12;

  // Scroll control handlers
  const handleBpmChange = useCallback((delta) => {
    setBpm((prev) => Math.min(200, Math.max(40, prev + delta)));
  }, []);

  const handleNumeratorChange = useCallback((delta) => {
    setTimeSignature((prev) => ({
      ...prev,
      numerator: Math.min(12, Math.max(1, prev.numerator + delta)),
    }));
  }, []);

  const bpmRef = useScrollControl(handleBpmChange, isPlaying);
  const numeratorRef = useScrollControl(handleNumeratorChange, isPlaying);

  // Apply theme to body
  useEffect(() => {
    document.body.className = theme === 'blue' ? '' : `theme-${theme}`;
  }, [theme]);

  const ensureAudioReady = useCallback(async () => {
    if (audioReady) return true;
    if (audioInitPromiseRef.current) return audioInitPromiseRef.current;

    setAudioError(false);

    // Helper to wrap promises with timeout
    const withTimeout = (promise, ms) => {
      return Promise.race([
        promise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), ms)
        )
      ]);
    };

    audioInitPromiseRef.current = (async () => {
      try {
        const audioContext = Tone.getContext().rawContext;

        // CRITICAL: Unlock mobile audio FIRST during user gesture
        // This plays silent audio to move iOS from "ambient" to "playback" mode
        // and activates the Web Audio graph on Android
        await unlockMobileAudio(audioContext);

        // Now start Tone.js with timeout (AudioContext should already be running from unlock)
        try {
          await withTimeout(Tone.start(), 2000);
        } catch {
          // Tone.start timed out or failed - try to continue anyway
        }

        // Final check - ensure AudioContext is running
        if (audioContext.state !== 'running') {
          try {
            await withTimeout(audioContext.resume(), 1000);
          } catch {
            // Ignore resume errors/timeout
          }
        }

        // Even if not 'running', try to create synths - some browsers report wrong state
        if (!synthRef.current) {
          synthRef.current = new Tone.MembraneSynth({
            pitchDecay: 0.008,
            octaves: 2,
            oscillator: { type: 'sine' },
            envelope: {
              attack: 0.001,
              decay: 0.3,
              sustain: 0,
              release: 0.1,
            },
          }).toDestination();
          synthRef.current.volume.value = -10;
        }

        if (!accentSynthRef.current) {
          accentSynthRef.current = new Tone.MembraneSynth({
            pitchDecay: 0.01,
            octaves: 2.5,
            oscillator: { type: 'sine' },
            envelope: {
              attack: 0.001,
              decay: 0.4,
              sustain: 0,
              release: 0.15,
            },
          }).toDestination();
          accentSynthRef.current.volume.value = -4;
        }

        setAudioReady(true);
        setAudioError(false);
        return true;
      } catch (err) {
        console.error('Audio init failed:', err);
        setAudioError(true);
        return false;
      }
    })();

    const ready = await audioInitPromiseRef.current;
    audioInitPromiseRef.current = null;
    return ready;
  }, [audioReady]);

  useEffect(() => {
    return () => {
      synthRef.current?.dispose();
      accentSynthRef.current?.dispose();
      loopRef.current?.dispose();
      Tone.Transport.stop();
      Tone.Transport.cancel();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Keep clickSound ref in sync
  useEffect(() => {
    clickSoundRef.current = clickSound;
  }, [clickSound]);

  // Update BPM
  useEffect(() => {
    if (audioReady) {
      Tone.Transport.bpm.value = bpm;
    }
  }, [bpm, audioReady]);

  // Animation loop for traveling light
  const animate = useCallback(() => {
    if (!isPlaying) {
      console.log('animate called but isPlaying is false');
      return;
    }

    const { numerator } = timeSignature;
    const beatDurationSec = 60 / Tone.Transport.bpm.value;
    const measureDurationSec = beatDurationSec * numerator;

    const transportSeconds = Tone.Transport.seconds;
    const measureProgress = (transportSeconds % measureDurationSec) / measureDurationSec;

    let newPos;
    if (numerator === 1) {
      newPos = { x: center, y: center };
    } else if (numerator === 2) {
      const x = center - shapeRadius + (shapeRadius * 2 * measureProgress);
      newPos = { x, y: center };
    } else {
      const points = getPolygonPoints(numerator, shapeRadius, center, center);
      newPos = interpolatePosition(points, measureProgress);
    }

    setLightPosition(newPos);
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [isPlaying, audioReady, timeSignature, center, shapeRadius]);

  // Start/stop animation loop
  useEffect(() => {
    console.log('Animation useEffect triggered, isPlaying:', isPlaying);
    if (isPlaying) {
      console.log('Starting animation loop');
      animationFrameRef.current = requestAnimationFrame(animate);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      const { numerator } = timeSignature;
      if (numerator >= 3) {
        const points = getPolygonPoints(numerator, shapeRadius, center, center);
        setLightPosition(points[0]);
      } else if (numerator === 2) {
        setLightPosition({ x: center - shapeRadius, y: center });
      } else {
        setLightPosition({ x: center, y: center });
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, audioReady, animate, timeSignature, center, shapeRadius]);

  // Handle beat trigger
  const triggerBeat = useCallback(
    (time) => {
      if (!synthRef.current || !accentSynthRef.current) return;

      const beatIndex = beatCountRef.current % timeSignature.numerator;
      const isFirstBeat = beatIndex === 0;
      const isHigh = clickSoundRef.current === 'high';

      if (isFirstBeat) {
        accentSynthRef.current?.triggerAttackRelease(isHigh ? 'C3' : 'C2', '16n', time);
      } else {
        synthRef.current?.triggerAttackRelease(isHigh ? 'G2' : 'G1', '16n', time);
      }

      Tone.Draw.schedule(() => {
        setCurrentBeat(beatIndex);
        setIsDownbeat(isFirstBeat);
        setBeatActive(true);

        const beatDuration = (60 / Tone.Transport.bpm.value) * 1000;
        const fadeDuration = beatDuration * 0.8;

        setTimeout(() => {
          setBeatActive(false);
          setIsDownbeat(false);
        }, fadeDuration);
      }, time);

      beatCountRef.current++;
    },
    [timeSignature.numerator]
  );

  // Setup loop
  useEffect(() => {
    if (isPlaying && audioReady) {
      beatCountRef.current = 0;
      loopRef.current?.dispose();
      loopRef.current = new Tone.Loop(triggerBeat, '4n');
      loopRef.current.start(0);
      Tone.Transport.start();
    } else {
      loopRef.current?.stop();
      loopRef.current?.dispose();
      loopRef.current = null;
      Tone.Transport.stop();
      Tone.Transport.position = 0;
      beatCountRef.current = 0;
      setCurrentBeat(0);
      setBeatActive(false);
      setIsDownbeat(false);
    }
  }, [isPlaying, audioReady, triggerBeat]);

  const handlePlayToggle = async () => {
    if (Tone.getContext().state !== 'running') {
      // Unlock audio for iOS - must happen on user gesture
      await unlockAudioForIOS();
      await Tone.start();
    }
    setIsPlaying(!isPlaying);
  };

  const beatDuration = 60 / bpm;
  const { numerator } = timeSignature;

  const shapePoints = numerator >= 3 ? getPolygonPoints(numerator, shapeRadius, center, center) : [];
  const polygonPath = shapePoints.length > 0
    ? shapePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
    : '';

  return (
    <div className="metronome-container">
      <h1 className="app-header">Metronome</h1>
      <div
        className={`visualization-container ${isDownbeat ? 'flex' : ''}`}
        style={{ '--beat-duration': `${beatDuration}s` }}
      >
        <svg
          width={svgSize}
          height={svgSize}
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          className="shape-svg"
        >
          {numerator === 1 && (
            <circle
              cx={center}
              cy={center}
              r={90}
              className={`shape-outline ${isDownbeat ? 'accent' : ''}`}
            />
          )}

          {numerator === 2 && (
            <>
              <line
                x1={center - shapeRadius}
                y1={center}
                x2={center + shapeRadius}
                y2={center}
                className="shape-outline"
              />
              <circle
                cx={center - shapeRadius}
                cy={center}
                r={9}
                className={`vertex-marker ${currentBeat === 0 && beatActive ? 'active' : ''} ${currentBeat === 0 && isDownbeat ? 'accent' : ''}`}
              />
              <circle
                cx={center + shapeRadius}
                cy={center}
                r={9}
                className={`vertex-marker ${currentBeat === 1 && beatActive ? 'active' : ''}`}
              />
            </>
          )}

          {numerator >= 3 && (
            <>
              <path d={polygonPath} className="shape-outline" />
              {shapePoints.map((point, index) => (
                <circle
                  key={index}
                  cx={point.x}
                  cy={point.y}
                  r={9}
                  className={`vertex-marker ${currentBeat === index && beatActive ? 'active' : ''} ${currentBeat === index && isDownbeat ? 'accent' : ''}`}
                />
              ))}
            </>
          )}

          {isPlaying && (
            <circle
              cx={lightPosition.x}
              cy={lightPosition.y}
              r={beatActive ? (isDownbeat ? 20 : 14) : 12}
              className={`traveling-light ${beatActive ? 'pulse' : ''} ${isDownbeat ? 'accent' : ''}`}
            />
          )}

          <circle
            cx={center}
            cy={center}
            r={dotRadius}
            className={`center-dot ${beatActive ? 'active' : ''} ${isDownbeat ? 'accent' : ''}`}
          />
        </svg>
      </div>

      <div className={`controls ${isPlaying ? 'disabled' : ''}`}>
        <div className="play-control">
          <button
            className={`play-button ${isPlaying ? 'playing' : ''}`}
            onClick={handlePlayToggle}
            aria-label={isPlaying ? 'Stop' : 'Play'}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="8,6 18,12 8,18" />
              </svg>
            )}
          </button>
          {audioError && <div className="audio-error">Tap again to enable sound</div>}
        </div>

        <div className={`control-with-arrows ${isPlaying ? 'disabled' : ''}`}>
          <button
            className="arrow-button arrow-up"
            onClick={() => !isPlaying && handleBpmChange(1)}
            disabled={isPlaying}
            aria-label="Increase BPM"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14l5-5 5 5H7z" />
            </svg>
          </button>
          <div
            ref={bpmRef}
            className={`scroll-control bpm-control ${isPlaying ? 'disabled' : ''}`}
            title={isPlaying ? 'Stop playback to adjust' : 'Hold and drag to adjust'}
          >
            <span className="scroll-control-value">{bpm}</span>
            <span className="scroll-control-label">BPM</span>
          </div>
          <button
            className="arrow-button arrow-down"
            onClick={() => !isPlaying && handleBpmChange(-1)}
            disabled={isPlaying}
            aria-label="Decrease BPM"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 10l5 5 5-5H7z" />
            </svg>
          </button>
        </div>

        <div className={`control-with-arrows ${isPlaying ? 'disabled' : ''}`}>
          <button
            className="arrow-button arrow-up"
            onClick={() => !isPlaying && handleNumeratorChange(1)}
            disabled={isPlaying}
            aria-label="Increase beats per measure"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14l5-5 5 5H7z" />
            </svg>
          </button>
          <div
            ref={numeratorRef}
            className={`scroll-control beats-control ${isPlaying ? 'disabled' : ''}`}
            title={isPlaying ? 'Stop playback to adjust' : 'Hold and drag to adjust'}
          >
            <span className="scroll-control-value">{timeSignature.numerator}</span>
            <span className="scroll-control-label">Beats/Measure</span>
          </div>
          <button
            className="arrow-button arrow-down"
            onClick={() => !isPlaying && handleNumeratorChange(-1)}
            disabled={isPlaying}
            aria-label="Decrease beats per measure"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 10l5 5 5-5H7z" />
            </svg>
          </button>
        </div>

        <button
          className="settings-button"
          onClick={() => setShowSettings(true)}
          aria-label="Settings"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* Settings Overlay */}
      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <span className="settings-title">Settings</span>
              <button className="settings-close" onClick={() => setShowSettings(false)}>
                &#x2715;
              </button>
            </div>

            <div className="settings-section">
              <div className="settings-section-label">Themes</div>
              <div className="theme-buttons">
                <button
                  className={`theme-btn theme-btn-white ${theme === 'white' ? 'active' : ''}`}
                  onClick={() => setTheme('white')}
                  aria-label="White theme"
                />
                <button
                  className={`theme-btn theme-btn-blue ${theme === 'blue' ? 'active' : ''}`}
                  onClick={() => setTheme('blue')}
                  aria-label="Blue theme"
                />
                <button
                  className={`theme-btn theme-btn-red ${theme === 'red' ? 'active' : ''}`}
                  onClick={() => setTheme('red')}
                  aria-label="Red theme"
                />
                <button
                  className={`theme-btn theme-btn-black ${theme === 'black' ? 'active' : ''}`}
                  onClick={() => setTheme('black')}
                  aria-label="Black theme"
                />
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-label">Click Sound</div>
              <div className="click-buttons">
                <button
                  className={`click-btn ${clickSound === 'normal' ? 'active' : ''}`}
                  onClick={() => setClickSound('normal')}
                >
                  Normal
                </button>
                <button
                  className={`click-btn ${clickSound === 'high' ? 'active' : ''}`}
                  onClick={() => setClickSound('high')}
                >
                  High
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Metronome;
