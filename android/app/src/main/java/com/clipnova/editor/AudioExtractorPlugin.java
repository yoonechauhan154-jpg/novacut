package com.clipnova.editor;

import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.MediaCodec;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;

/**
 * Extracts only the used time range of an audio track from a source file,
 * writing it to a small M4A cache file without re-encoding (sample copy).
 * JS then decodes this small file with decodeAudioData into the OfflineAudioContext mix.
 * This avoids decoding the whole 50-300 MB source audio on the WebView side.
 */
@CapacitorPlugin(name = "AudioExtractor")
public class AudioExtractorPlugin extends Plugin {
  @PluginMethod
  public void extractAudioRange(PluginCall call) {
    String mediaUrl = call.getString("mediaUrl");
    double sourceStart = call.getDouble("sourceStart", 0.0);
    double sourceEnd = call.getDouble("sourceEnd", 0.0);
    if (mediaUrl == null || mediaUrl.isEmpty()) {
      call.reject("mediaUrl is required"); return;
    }
    if (sourceEnd <= sourceStart) {
      call.reject("sourceEnd must be > sourceStart"); return;
    }

    File source = new File(Uri.parse(mediaUrl).getPath());
    if (!source.isFile()) {
      call.reject("Source file not found: " + mediaUrl); return;
    }

    MediaExtractor extractor = new MediaExtractor();
    MediaMuxer muxer = null;
    File output = null;
    try {
      extractor.setDataSource(source.getAbsolutePath());
      int audioTrack = -1;
      for (int i = 0; i < extractor.getTrackCount(); i++) {
        MediaFormat fmt = extractor.getTrackFormat(i);
        String mime = fmt.getString(MediaFormat.KEY_MIME);
        if (mime != null && mime.startsWith("audio/")) {
          audioTrack = i;
          break;
        }
      }
      if (audioTrack < 0) {
        call.reject("No audio track in source"); return;
      }
      extractor.selectTrack(audioTrack);
      MediaFormat format = extractor.getTrackFormat(audioTrack);

      long startUs = (long)(sourceStart * 1_000_000);
      long endUs = (long)(sourceEnd * 1_000_000);
      extractor.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC);

      String cache = getContext().getCacheDir().getAbsolutePath();
      output = File.createTempFile("clipnova-audio-", ".m4a", new File(cache));
      muxer = new MediaMuxer(output.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
      int trackIdx = muxer.addTrack(format);

      ByteBuffer buf = ByteBuffer.allocate(256 * 1024);
      MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
      long totalBytes = 0;
      int samples = 0;
      while (true) {
        int read = extractor.readSampleData(buf, 0);
        if (read < 0) break;
        long sampleTimeUs = extractor.getSampleTime();
        if (sampleTimeUs < 0) break;
        if (sampleTimeUs >= endUs) break;
        if (sampleTimeUs < startUs) {
          extractor.advance();
          continue;
        }
        buf.limit(read);
        info.offset = 0;
        info.size = read;
        info.presentationTimeUs = sampleTimeUs - startUs;
        info.flags = extractor.getSampleFlags();
        muxer.writeSampleData(trackIdx, buf, info);
        totalBytes += read;
        samples++;
        extractor.advance();
      }
      muxer.stop();

      call.resolve(new JSObject()
        .put("uri", Uri.fromFile(output).toString())
        .put("path", output.getAbsolutePath())
        .put("size", output.length())
        .put("samples", samples)
        .put("durationSeconds", (sourceEnd - sourceStart)));
    } catch (Exception e) {
      call.reject("AudioExtractor: " + e.getMessage());
    } finally {
      try { extractor.release(); } catch (Exception ignored) {}
      if (muxer != null) {
        try { muxer.release(); } catch (Exception ignored) {}
      }
    }
  }
}
