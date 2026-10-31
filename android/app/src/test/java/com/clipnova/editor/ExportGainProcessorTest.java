package com.clipnova.editor;
import org.junit.Test;
import static org.junit.Assert.*;

public class ExportGainProcessorTest {
  @Test public void fadeAndVolumePreserveEndpoints() {
    assertEquals(0, ExportGainProcessor.gain(0, 4, .2, .2, .5), .0001);
    assertEquals(.25, ExportGainProcessor.gain(.1, 4, .2, .2, .5), .0001);
    assertEquals(.5, ExportGainProcessor.gain(2, 4, .2, .2, .5), .0001);
    assertEquals(.25, ExportGainProcessor.gain(3.9, 4, .2, .2, .5), .0001);
    assertEquals(0, ExportGainProcessor.gain(4, 4, .2, .2, .5), .0001);
  }
  @Test public void zeroVolumeDoesNotBecomeDefaultVolume() {
    assertEquals(0, ExportGainProcessor.gain(1, 4, 0, 0, 0), .0001);
    assertEquals(2, ExportGainProcessor.gain(1, 4, 0, 0, 2), .0001);
  }
}
