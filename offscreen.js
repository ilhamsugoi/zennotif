// =====================================================================
// === ZenNotif - Offscreen (Audio Player + Tone Generator) ===
// =====================================================================

// Tone generators using Web Audio API
function generateTone(type, volume) {
  const ctx = new AudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.value = volume;

  if (type === 'bell') {
    // Two-tone bell: ding-dong
    playNote(ctx, gain, 880, 0, 0.15);
    playNote(ctx, gain, 660, 0.2, 0.25);
  } else if (type === 'chime') {
    // Gentle ascending chime
    playNote(ctx, gain, 523, 0, 0.12);
    playNote(ctx, gain, 659, 0.15, 0.12);
    playNote(ctx, gain, 784, 0.3, 0.2);
  } else if (type === 'alert') {
    // Urgent double beep
    playNote(ctx, gain, 1000, 0, 0.1);
    playNote(ctx, gain, 1000, 0.15, 0.1);
    playNote(ctx, gain, 1200, 0.3, 0.15);
  } else if (type === 'soft') {
    // Soft single tone
    playNote(ctx, gain, 440, 0, 0.3, 'sine');
  }

  // Close context after tones finish
  setTimeout(() => ctx.close(), 2000);
}

function playNote(ctx, gain, freq, startTime, duration, waveType = 'triangle') {
  const osc = ctx.createOscillator();
  osc.type = waveType;
  osc.frequency.value = freq;
  osc.connect(gain);
  osc.start(ctx.currentTime + startTime);
  osc.stop(ctx.currentTime + startTime + duration);
}

// Message listener
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;

  if (msg.type === 'play-sound') {
    const volume = msg.volume ?? 0.8;
    const tone = msg.tone ?? 'default';

    if (tone === 'default') {
      // Play the MP3 file
      const audio = new Audio(msg.url);
      audio.volume = volume;
      audio.play();
    } else {
      // Generate tone using Web Audio API
      generateTone(tone, volume);
    }
  }
});

// Pinger interval in offscreen to prevent Chrome background tab throttling.
// This ensures the 10-second interval runs on time and keeps the audio connection alive.
setInterval(() => {
  chrome.runtime.sendMessage({ type: 'offscreen-ping' }).catch(() => {});
}, 5000);
