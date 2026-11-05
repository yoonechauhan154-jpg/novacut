package com.clipnova.editor;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;
import java.nio.ByteBuffer;

/** Clip volume and fades, applied before the item's speed transformation. */
@UnstableApi
final class ExportGainProcessor extends BaseAudioProcessor {
  private final float volume;
  private final double fadeIn, fadeOut, duration, speed;
  private long frame;
  ExportGainProcessor(float volume, double fadeIn, double fadeOut, double duration, double speed) {
    this.volume = volume; this.fadeIn = fadeIn; this.fadeOut = fadeOut; this.duration = duration; this.speed = speed;
  }
  @Override protected AudioProcessor.AudioFormat onConfigure(AudioProcessor.AudioFormat input) throws AudioProcessor.UnhandledAudioFormatException {
    if (input.encoding != C.ENCODING_PCM_16BIT) throw new AudioProcessor.UnhandledAudioFormatException(input);
    return input;
  }
  @Override protected void onFlush() { frame = 0; }
  static double gain(double time, double duration, double fadeIn, double fadeOut, double volume) {
    double in = fadeIn > 0 ? Math.min(1, time / fadeIn) : 1;
    double out = fadeOut > 0 ? Math.min(1, (duration - time) / fadeOut) : 1;
    return volume * Math.max(0, Math.min(in, out));
  }
  @Override public void queueInput(ByteBuffer input) {
    ByteBuffer output = replaceOutputBuffer(input.remaining());
    int channels = inputAudioFormat.channelCount;
    while (input.remaining() >= channels * 2) {
      double time = frame / (double) inputAudioFormat.sampleRate / speed;
      double gain = gain(time, duration, fadeIn, fadeOut, volume);
      for (int c = 0; c < channels; c++) output.putShort((short)Math.max(-32768, Math.min(32767, Math.round(input.getShort() * gain))));
      frame++;
    }
    output.flip();
  }
}
