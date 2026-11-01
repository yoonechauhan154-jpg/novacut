package com.clipnova.editor;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Pure, Android-free size/copy/verify logic extracted from MediaSaverPlugin.saveVideo.
 * No Context, ContentResolver, PluginCall, or Android APIs, so it can be unit-tested with
 * plain JUnit (no Robolectric). The finished export file itself is authoritative; a
 * JS-provided expectedSize is only an optional hint.
 */
public final class ExportSaveVerifier {
  private ExportSaveVerifier() {}

  /** Copies src into out, returning total bytes written. */
  public static long copyFile(File src, OutputStream out) throws IOException {
    long total = 0;
    byte[] buf = new byte[64 * 1024];
    try (InputStream in = new FileInputStream(src)) {
      int n;
      while ((n = in.read(buf)) != -1) {
        out.write(buf, 0, n);
        total += n;
      }
    }
    out.flush();
    return total;
  }

  /**
   * Validates the finished export input before publishing.
   * A missing or zero expectedSize is accepted (not treated as a mismatch); only a positive
   * expectedSize that disagrees with the real file length is rejected. Returns the actual
   * byte length of src.
   */
  public static long validateInput(File src, long expectedSize) throws IOException {
    if (src == null || !src.isFile()) {
      throw new IOException("Finished export file is missing");
    }
    long actual = src.length();
    if (actual <= 0) {
      throw new IOException("Finished export file is empty");
    }
    if (expectedSize > 0 && actual != expectedSize) {
      throw new IOException("Input size mismatch: actual=" + actual + " bytes, expected=" + expectedSize + " bytes");
    }
    return actual;
  }

  /**
   * Verifies the copy after it finishes: bytes written must equal the input size and the
   * input file must not have changed during the copy.
   */
  public static void verifyWritten(long written, long inputSize, File src) throws IOException {
    if (written != inputSize || src.length() != inputSize) {
      throw new IOException("MediaStore copy size mismatch: written=" + written
          + ", input=" + inputSize + ", currentInput=" + src.length());
    }
  }
}
