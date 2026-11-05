package com.clipnova.editor;
import androidx.media3.common.Effect;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.SonicAudioProcessor;
import androidx.media3.effect.SpeedChangeEffect;
import java.util.List;

/** Constant-rate audio and video receive exactly one matching speed operation. */
final class ExportSpeed {
  final float speed;
  final float pitch;
  ExportSpeed(float speed, boolean keepPitch) {
    if (!Float.isFinite(speed) || speed < .1f || speed > 10f) throw new IllegalArgumentException("Speed must be 0.1x to 10x");
    this.speed = speed; this.pitch = keepPitch ? 1f : speed;
  }
  void append(List<AudioProcessor> audio, List<Effect> video, boolean audioOnly) {
    SonicAudioProcessor sonic = new SonicAudioProcessor();
    sonic.setSpeed(speed); sonic.setPitch(pitch); audio.add(sonic);
    if (!audioOnly) video.add(new SpeedChangeEffect(speed));
  }
}
