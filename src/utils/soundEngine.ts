import { TimelineClip, VoiceChangerPreset } from '../types/editor';

class ClipNovaSoundEngine {
  private ctx: AudioContext | null = null;
  private lastBeatTriggered: number = -1;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /** Public resume so the Play button can restart the AudioContext on user gesture (Android WebView requirement). */
  public resume(): void {
    this.ensureContext();
  }

  public triggerTimelineAudioTick(
    playheadTime: number,
    clips: TimelineClip[],
    isPlaying: boolean
  ) {
    if (!isPlaying) {
      this.lastBeatTriggered = -1;
      return;
    }

    const activeAudioClips = clips.filter(
      (c) =>
        c.trackType === 'audio' &&
        !c.muted &&
        c.volume > 0 &&
        playheadTime >= c.startTime &&
        playheadTime <= c.startTime + c.duration
    );

    if (activeAudioClips.length === 0) return;

    const bucket = Math.floor(playheadTime * 8);
    if (bucket === this.lastBeatTriggered) return;
    this.lastBeatTriggered = bucket;

    const ctx = this.ensureContext();
    if (!ctx) return;

    for (const clip of activeAudioClips) {
      const relTime = playheadTime - clip.startTime;
      let gainMultiplier = clip.volume / 100;
      if (clip.fadeIn > 0 && relTime < clip.fadeIn) {
        gainMultiplier *= Math.max(0, relTime / clip.fadeIn);
      }
      if (clip.fadeOut > 0 && clip.duration - relTime < clip.fadeOut) {
        gainMultiplier *= Math.max(0, (clip.duration - relTime) / clip.fadeOut);
      }

      const step = bucket % 8;
      this.playSynthStep(
        ctx,
        clip.synthPreset || 'desi-hiphop',
        step,
        gainMultiplier * 0.18,
        clip.voiceChanger || 'none',
        Boolean(clip.noiseReduction)
      );
    }
  }

  private playSynthStep(
    ctx: AudioContext,
    preset: NonNullable<TimelineClip['synthPreset']>,
    step: number,
    volume: number,
    voiceChanger: VoiceChangerPreset,
    noiseReduction: boolean
  ) {
    const now = ctx.currentTime;

    // Pitch multiplier from Voice Changer
    let pitchMult = 1.0;
    if (voiceChanger === 'deep-cinema') pitchMult = 0.72;
    else if (voiceChanger === 'chipmunk') pitchMult = 1.55;
    else if (voiceChanger === 'robot-mod') pitchMult = step % 2 === 0 ? 0.85 : 1.15;

    // Optional Noise Reduction Biquad Filter
    const destinationNode: AudioNode = (() => {
      if (!noiseReduction) return ctx.destination;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(600, now);
      filter.Q.setValueAtTime(0.7, now);
      filter.connect(ctx.destination);
      return filter;
    })();

    // Kick or Dhol bass on steps 0, 3, 4
    if (step === 0 || step === 4 || (preset === 'wedding-shehnai' && step === 3)) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const baseFreq =
        (preset === 'wedding-shehnai' ? 145 : preset === 'lofi-monsoon' ? 95 : 120) *
        pitchMult;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.11);

      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(destinationNode);
      osc.start(now);
      osc.stop(now + 0.13);
    }

    // Melodic pluck / synth chord on steps 2, 5, 6
    if (step === 2 || step === 5 || step === 6) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const scaleMap: Record<string, number[]> = {
        'desi-hiphop': [220, 261.63, 293.66, 329.63, 392.0],
        'wedding-shehnai': [293.66, 329.63, 369.99, 440.0, 523.25],
        'cyber-synth': [196.0, 246.94, 293.66, 392.0, 493.88],
        'lofi-monsoon': [261.63, 329.63, 392.0, 493.88, 587.33],
        'cinematic-riser': [110.0, 146.83, 164.81, 220.0, 293.66],
      };

      const notes = scaleMap[preset] || scaleMap['desi-hiphop'];
      const noteFreq = notes[step % notes.length] * pitchMult;

      osc.type =
        voiceChanger === 'robot-mod'
          ? 'square'
          : preset === 'wedding-shehnai'
          ? 'sawtooth'
          : preset === 'cyber-synth'
          ? 'triangle'
          : 'sine';
      osc.frequency.setValueAtTime(noteFreq, now);

      gain.gain.setValueAtTime(volume * 0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc.connect(gain);
      gain.connect(destinationNode);
      osc.start(now);
      osc.stop(now + 0.17);
    }
  }

  public speakTextToSpeech(
    text: string,
    lang: 'hi-IN' | 'en-IN' | 'en-US',
    pitch: number = 1.0,
    rate: number = 1.0
  ): boolean {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return false;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.pitch = pitch;
      utterance.rate = rate;
      const voices = window.speechSynthesis.getVoices();
      const matched = voices.find((v) => v.lang.toLowerCase().includes(lang.toLowerCase().slice(0, 2)));
      if (matched) utterance.voice = matched;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }

  public generateAutoBeatMarkers(duration: number, bpm: number = 108): number[] {
    const interval = Number((60 / bpm).toFixed(2));
    const markers: number[] = [];
    for (let t = interval; t < duration - 0.15; t = Number((t + interval).toFixed(2))) {
      markers.push(t);
    }
    return markers;
  }

  public async startVoiceoverRecording(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.recordedChunks = [];
      const preferredMimes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/aac',
      ];
      const supportedMime =
        typeof MediaRecorder !== 'undefined'
          ? preferredMimes.find((m) => MediaRecorder.isTypeSupported(m))
          : undefined;

      this.mediaRecorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.recordedChunks.push(e.data);
      };
      this.mediaRecorder.start(250);
      return true;
    } catch {
      return false;
    }
  }

  public stopVoiceoverRecording(): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(null);
        return;
      }
      const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        this.mediaRecorder?.stream.getTracks().forEach((t) => t.stop());
        resolve(url);
      };
      this.mediaRecorder.stop();
    });
  }
}

export const soundEngine = new ClipNovaSoundEngine();
