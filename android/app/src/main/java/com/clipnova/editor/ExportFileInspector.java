package com.clipnova.editor;

import android.graphics.Bitmap;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import com.getcapacitor.JSObject;
import java.io.File;

/** Reads the finished file, not Transformer estimates. Runs on the export worker thread. */
final class ExportFileInspector {
  static JSObject inspect(File file, double expectedDuration, boolean expectAudio, boolean expectMotion) throws Exception {
    MediaExtractor extractor = new MediaExtractor();
    long frames = 0;
    boolean hasAudio = false, hasVideo = false;
    int width = 0, height = 0;
    try {
      extractor.setDataSource(file.getAbsolutePath());
      for (int i = 0; i < extractor.getTrackCount(); i++) {
        MediaFormat format = extractor.getTrackFormat(i);
        String mime = format.getString(MediaFormat.KEY_MIME);
        if (mime != null && mime.startsWith("audio/")) {
          extractor.selectTrack(i);
          extractor.seekTo(0, MediaExtractor.SEEK_TO_CLOSEST_SYNC);
          hasAudio = extractor.getSampleTime() >= 0;
          extractor.unselectTrack(i);
        }
        if (mime != null && mime.startsWith("video/")) {
          hasVideo = true;
          width = format.getInteger(MediaFormat.KEY_WIDTH);
          height = format.getInteger(MediaFormat.KEY_HEIGHT);
          extractor.selectTrack(i);
          extractor.seekTo(0, MediaExtractor.SEEK_TO_CLOSEST_SYNC);
          while (extractor.getSampleTime() >= 0) { frames++; if (!extractor.advance()) break; }
          extractor.unselectTrack(i);
        }
      }
    } finally { extractor.release(); }
    if (!hasVideo || frames < 1 || file.length() <= 0) throw new Exception("Output has no video samples");
    if (expectAudio && !hasAudio) throw new Exception("Output audio stream is missing");
    MediaMetadataRetriever retriever = new MediaMetadataRetriever();
    double duration;
    boolean changing = false;
    try {
      retriever.setDataSource(file.getAbsolutePath());
      duration = Double.parseDouble(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)) / 1000.0;
      if (!Double.isFinite(duration) || Math.abs(duration - expectedDuration) > Math.max(.35, expectedDuration * .03))
        throw new Exception("Output duration mismatch: " + duration + " / " + expectedDuration);
      int[] previous = null;
      for (double fraction : new double[] {.05, .23, .41, .59, .77, .95}) {
        Bitmap bitmap = retriever.getScaledFrameAtTime((long)(duration * fraction * 1000000), MediaMetadataRetriever.OPTION_CLOSEST, 32, 32);
        if (bitmap == null) throw new Exception("Output frame cannot be decoded");
        Bitmap small = Bitmap.createScaledBitmap(bitmap, 32, 32, true);
        int[] pixels = new int[1024];
        small.getPixels(pixels, 0, 32, 0, 0, 32, 32);
        if (previous != null) {
          long difference = 0;
          for (int p = 0; p < pixels.length; p++) {
            for (int shift : new int[] {0, 8, 16})
              difference += Math.abs(((pixels[p] >> shift) & 255) - ((previous[p] >> shift) & 255));
          }
          if (difference / 3072.0 > 1.5) changing = true;
        }
        previous = pixels;
        if (small != bitmap) small.recycle();
        bitmap.recycle();
      }
    } finally { retriever.release(); }
    if (expectMotion && !changing) throw new Exception("Frames are not changing in six native output samples");
    JSObject result = new JSObject();
    result.put("duration", duration); result.put("frames", frames); result.put("size", file.length());
    result.put("hasAudio", hasAudio); result.put("framesChanging", changing);
    result.put("width", width); result.put("height", height); result.put("verified", true);
    return result;
  }
}
