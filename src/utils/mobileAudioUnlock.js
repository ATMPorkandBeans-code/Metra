/**
 * Mobile Audio Unlock Utility
 * 
 * iOS and Android browsers treat Web Audio API as "ambient" audio,
 * which respects silent mode and may not play through device speakers.
 * 
 * This utility "unlocks" mobile audio by playing:
 * 1. A silent HTML5 Audio element (tricks iOS into "playback" mode)
 * 2. A silent buffer through the raw AudioContext (activates Web Audio)
 * 
 * Must be called during a user gesture (tap/click) for it to work.
 */

// Smallest valid silent MP3 file (base64 encoded)
const SILENT_MP3_BASE64 = 
  'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwmHAAAAAAD/+9DEAAAIAANIAAAAQAAAaQAAAAQAAANIAAAAQAAAaQAAAATEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tQxBkAAADSAAAAAAAAANIAAAAATEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=';

// Maximum time to wait for any unlock operation (ms)
const UNLOCK_TIMEOUT = 500;

/**
 * Wrap a promise with a timeout - resolves with fallback value if timeout exceeded
 */
function withTimeout(promise, timeoutMs, fallbackValue) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), timeoutMs))
  ]);
}

/**
 * Play a silent HTML5 Audio element to unlock iOS audio
 * This moves iOS from "ambient" to "playback" audio category
 */
function playSilentHtmlAudio() {
  return new Promise((resolve) => {
    try {
      const audio = new Audio(`data:audio/mp3;base64,${SILENT_MP3_BASE64}`);
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('webkit-playsinline', 'true');
      audio.volume = 0.001;
      
      // Add event listeners for all possible outcomes
      audio.addEventListener('ended', () => resolve(true), { once: true });
      audio.addEventListener('error', () => resolve(false), { once: true });
      audio.addEventListener('abort', () => resolve(false), { once: true });
      
      const playPromise = audio.play();
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            // Successfully started - wait a tiny bit then resolve
            setTimeout(() => {
              try {
                audio.pause();
                audio.src = '';
              } catch {
                // Ignore cleanup errors
              }
              resolve(true);
            }, 50);
          })
          .catch(() => {
            resolve(false);
          });
      } else {
        // Older browsers without promise support - assume success
        setTimeout(() => resolve(true), 50);
      }
    } catch {
      resolve(false);
    }
  });
}

/**
 * Play a silent buffer through the AudioContext
 * This activates the Web Audio graph on mobile browsers
 */
function playSilentBuffer(audioContext) {
  return new Promise((resolve) => {
    try {
      if (!audioContext || audioContext.state === 'closed') {
        resolve(false);
        return;
      }
      
      // Create a silent buffer (1 sample at 22050Hz)
      const buffer = audioContext.createBuffer(1, 1, 22050);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      
      source.onended = () => resolve(true);
      source.start(0);
      
      // Short fallback timeout
      setTimeout(() => resolve(true), 50);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Unlock mobile audio for both iOS and Android
 * 
 * Call this function during a user gesture (tap/click) BEFORE
 * initializing Tone.js or playing any Web Audio.
 * 
 * @param {AudioContext} audioContext - The raw AudioContext from Tone.js
 * @returns {Promise<boolean>} - True if unlock was successful
 */
export async function unlockMobileAudio(audioContext) {
  // Wrap everything in a timeout to ensure we never hang
  try {
    // Run both unlock methods in parallel with individual timeouts
    const [htmlAudioResult, bufferResult] = await withTimeout(
      Promise.all([
        withTimeout(playSilentHtmlAudio(), UNLOCK_TIMEOUT, false),
        withTimeout(playSilentBuffer(audioContext), UNLOCK_TIMEOUT, false),
      ]),
      UNLOCK_TIMEOUT + 100,
      [false, false]
    );
    
    // Resume the AudioContext (required by all mobile browsers)
    if (audioContext && audioContext.state === 'suspended') {
      await withTimeout(
        audioContext.resume().catch(() => {}),
        UNLOCK_TIMEOUT,
        undefined
      );
    }
    
    const success = htmlAudioResult || bufferResult || 
      (audioContext && audioContext.state === 'running');
    
    return success;
  } catch {
    // If anything fails, still try to resume and continue
    try {
      if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
      }
    } catch {
      // Ignore
    }
    return audioContext?.state === 'running';
  }
}

/**
 * Check if we're likely on a mobile device that needs audio unlocking
 */
export function isMobileDevice() {
  if (typeof globalThis.window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 && /Mobile|Tablet/i.test(navigator.userAgent));
}
