package com.clipnova.editor;
import androidx.media3.common.Effect;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.SonicAudioProcessor;
import androidx.media3.effect.SpeedChangeEffect;
import java.util.ArrayList;
import org.junit.Test;
import static org.junit.Assert.*;
public class ExportSpeedTest {
  @Test public void slowAndFastUseMatchingAudioVideoEffects() {
    for (float speed : new float[]{.1f, .5f, 1f, 2f, 10f}) {
      ExportSpeed spec = new ExportSpeed(speed, true);
      assertEquals(speed, spec.speed, 0f); assertEquals(1f, spec.pitch, 0f);
      ArrayList<AudioProcessor> audio = new ArrayList<>(); ArrayList<Effect> video = new ArrayList<>();
      spec.append(audio, video, false);
      assertEquals(1, audio.size()); assertTrue(audio.get(0) instanceof SonicAudioProcessor);
      assertEquals(1, video.size()); assertTrue(video.get(0) instanceof SpeedChangeEffect);
      assertEquals(speed, new ExportSpeed(speed, false).pitch, 0f);
    }
  }
  @Test public void audioOnlyHasNoVisualSpeedOperation() {
    ArrayList<AudioProcessor> audio = new ArrayList<>(); ArrayList<Effect> video = new ArrayList<>();
    new ExportSpeed(2f, true).append(audio, video, true);
    assertEquals(1, audio.size()); assertTrue(video.isEmpty());
  }
  @Test(expected = IllegalArgumentException.class) public void rejectsInvalidSpeed() { new ExportSpeed(0f, true); }
}
