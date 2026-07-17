// Sound alert generator using the browser Web Audio API

/**
 * Plays a double-tone clean alert sound.
 * Designed to provide audio-feedback when stock gets low.
 */
function playAlertSound() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        const audioCtx = new AudioContextClass();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        oscillator.frequency.setValueAtTime(698.46, audioCtx.currentTime + 0.15); // F5

        gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);

        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.45);
    } catch (e) {
        console.warn("Audio Context blocked or not supported on this browser.", e);
    }
}

// Expose to window namespace
window.AudioManager = {
    playAlertSound
};
