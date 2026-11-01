package com.clipnova.editor;

import org.junit.Test;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

/**
 * Plain JUnit (no Robolectric) coverage for the pure size/copy/verify logic extracted from
 * MediaSaverPlugin.saveVideo into {@link ExportSaveVerifier}. No Android APIs are touched.
 */
public class ExportSaveVerifierTest {

  @Test
  public void sevenMbFileSuccessAndSizeEqualsInput() throws Exception {
    File src = tempFile(7L * 1024 * 1024);
    File dst = null;
    try {
      // explicit expectedSize that matches the real file length
      long actual = ExportSaveVerifier.validateInput(src, src.length());
      assertEquals(7L * 1024 * 1024, actual);
      assertEquals(src.length(), actual);

      dst = File.createTempFile("copy-", ".bin");
      long written;
      try (OutputStream out = new FileOutputStream(dst)) {
        written = ExportSaveVerifier.copyFile(src, out);
      }
      assertEquals(src.length(), written);
      assertArrayEquals(Files.readAllBytes(src.toPath()), Files.readAllBytes(dst.toPath()));

      ExportSaveVerifier.verifyWritten(written, src.length(), src);
    } finally {
      src.delete();
      if (dst != null) dst.delete();
    }
  }

  @Test
  public void missingOrZeroExpectedSizeStillSucceeds() throws Exception {
    File src = tempFile(1024);
    try {
      assertEquals(src.length(), ExportSaveVerifier.validateInput(src, 0));
      assertEquals(src.length(), ExportSaveVerifier.validateInput(src, -1));
    } finally {
      src.delete();
    }
  }

  @Test
  public void wrongExpectedSizeGivesClearError() throws Exception {
    File src = tempFile(100);
    try {
      try {
        ExportSaveVerifier.validateInput(src, src.length() + 1);
        fail("expected IOException for mismatched expectedSize");
      } catch (IOException e) {
        String msg = e.getMessage();
        assertTrue("unexpected message: " + msg, msg.contains("Input size mismatch"));
        assertTrue("unexpected message: " + msg, msg.contains("actual=" + src.length()));
        assertTrue("unexpected message: " + msg, msg.contains("expected=" + (src.length() + 1)));
      }
    } finally {
      src.delete();
    }
  }

  private static File tempFile(long bytes) throws IOException {
    File f = File.createTempFile("export-verify-", ".mp4");
    long remaining = bytes;
    try (OutputStream out = new FileOutputStream(f)) {
      byte[] buf = new byte[8192];
      while (remaining > 0) {
        int n = (int) Math.min(buf.length, remaining);
        out.write(buf, 0, n);
        remaining -= n;
      }
    }
    assertEquals(bytes, f.length());
    return f;
  }
}
