import { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';
import './Metronome.css';

// Generate polygon points for SVG
const getPolygonPoints = (sides, radius, centerX, centerY) => {
  const points = [];
  const angleOffset = -Math.PI / 2; // Start from top

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

// Custom hook for mousedown + drag to scrub value
const useScrollControl = (onChange, disabled) => {
  const elementRef = useRef(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const accumulatedDeltaRef = useRef(0);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const handleMouseDown = (e) => {
      if (disabled) return;
      e.preventDefault();
      isDraggingRef.current = true;
      startYRef.current = e.clientY;
      accumulatedDeltaRef.current = 0;
      element.classList.add('holding');
      document.body.style.cursor = 'ns-resize';
    };

    const handleMouseMove = (e) => {
      if (!isDraggingRef.current || disabled) return;

      // Calculate how far we've moved from start position
      const deltaY = startYRef.current - e.clientY;

      // Accumulate the delta - every 10 pixels triggers a change
      const threshold = 10;
      const totalDelta = accumulatedDeltaRef.current + deltaY;

      if (Math.abs(totalDelta) >= threshold) {
        const steps = Math.floor(totalDelta / threshold);
        onChange(steps);
        // Reset the start position and accumulated delta
        startYRef.current = e.clientY;
        accumulatedDeltaRef.current = totalDelta % threshold;
      }
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        element.classList.remove('holding');
        document.body.style.cursor = '';
      }
    };

    element.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      element.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onChange, disabled]);

  return elementRef;
};

const Metronome = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [beatActive, setBeatActive] = useState(false);
  const [timeSignature, setTimeSignature] = useState({ numerator: 4, denominator: 4 });
  const [currentBeat, setCurrentBeat] = useState(0);
  const [isDownbeat, setIsDownbeat] = useState(false);
  const [lightPosition, setLightPosition] = useState({ x: 210, y: 60 });

  const synthRef = useRef(null);
  const accentSynthRef = useRef(null);
  const loopRef = useRef(null);
  const beatCountRef = useRef(0);
  const animationFrameRef = useRef(null);

  // SVG dimensions (constant) - 1.5x larger
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

  const handleDenominatorChange = useCallback((delta) => {
    const denominators = [2, 4, 6, 8];
    setTimeSignature((prev) => {
      const currentIndex = denominators.indexOf(prev.denominator);
      const newIndex = Math.min(
        denominators.length - 1,
        Math.max(0, currentIndex + delta)
      );
      return { ...prev, denominator: denominators[newIndex] };
    });
  }, []);

  // Scroll control refs
  const bpmRef = useScrollControl(handleBpmChange, isPlaying);
  const numeratorRef = useScrollControl(handleNumeratorChange, isPlaying);
  const denominatorRef = useScrollControl(handleDenominatorChange, isPlaying);

  // Initialize Tone.js synths
  useEffect(() => {
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

  // Update BPM
  useEffect(() => {
    Tone.Transport.bpm.value = bpm;
  }, [bpm]);

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
  }, [isPlaying, timeSignature, center, shapeRadius]);

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
  }, [isPlaying, animate, timeSignature, center, shapeRadius]);

  // Handle beat trigger
  const triggerBeat = useCallback(
    (time) => {
      const beatIndex = beatCountRef.current % timeSignature.numerator;
      const isFirstBeat = beatIndex === 0;

      if (isFirstBeat) {
        accentSynthRef.current?.triggerAttackRelease('C2', '16n', time);
      } else {
        synthRef.current?.triggerAttackRelease('G1', '16n', time);
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
    if (isPlaying) {
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
  }, [isPlaying, triggerBeat]);

  const handlePlayToggle = async () => {
    if (Tone.context.state !== 'running') {
      await Tone.start();
    }
    setIsPlaying(!isPlaying);
  };

  const beatDuration = 60 / bpm;
  const { numerator } = timeSignature;

  // Get shape points
  const shapePoints = numerator >= 3 ? getPolygonPoints(numerator, shapeRadius, center, center) : [];

  // Create polygon path
  const polygonPath = shapePoints.length > 0
    ? shapePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
    : '';

  return (
    <div className="metronome-container">
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
          {/* Shape based on time signature numerator */}
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

          {/* Traveling light - always visible when playing */}
          {isPlaying && (
            <circle
              cx={lightPosition.x}
              cy={lightPosition.y}
              r={beatActive ? (isDownbeat ? 20 : 14) : 12}
              className={`traveling-light ${beatActive ? 'pulse' : ''} ${isDownbeat ? 'accent' : ''}`}
            />
          )}

          {/* Center beat dot */}
          <circle
            cx={center}
            cy={center}
            r={dotRadius}
            className={`center-dot ${beatActive ? 'active' : ''} ${isDownbeat ? 'accent' : ''}`}
          />
        </svg>
      </div>

      <div className={`controls ${isPlaying ? 'disabled' : ''}`}>
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

        <div
          ref={bpmRef}
          className={`scroll-control bpm-control ${isPlaying ? 'disabled' : ''}`}
          title={isPlaying ? 'Stop playback to adjust' : 'Hold and scroll to adjust'}
        >
          <span className="scroll-control-value">{bpm}</span>
          <span className="scroll-control-label">BPM</span>
        </div>

        <div className={`time-sig-control ${isPlaying ? 'disabled' : ''}`}>
          <div
            ref={numeratorRef}
            className={`scroll-control time-sig-num ${isPlaying ? 'disabled' : ''}`}
            title={isPlaying ? 'Stop playback to adjust' : 'Hold and scroll to adjust'}
          >
            <span className="scroll-control-value">{timeSignature.numerator}</span>
          </div>
          <span className="time-sig-slash">/</span>
          <div
            ref={denominatorRef}
            className={`scroll-control time-sig-denom ${isPlaying ? 'disabled' : ''}`}
            title={isPlaying ? 'Stop playback to adjust' : 'Hold and scroll to adjust'}
          >
            <span className="scroll-control-value">{timeSignature.denominator}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Metronome;
