package com.clipnova.editor;

import android.content.ContentValues;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import androidx.media3.common.C;
import androidx.media3.common.Effect;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.OverlaySettings;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.ChannelMixingAudioProcessor;
import androidx.media3.common.audio.ChannelMixingMatrix;
import androidx.media3.common.audio.SpeedProvider;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.BitmapOverlay;
import androidx.media3.effect.OverlayEffect;
import androidx.media3.effect.Presentation;
import androidx.media3.effect.StaticOverlaySettings;
import androidx.media3.effect.TextureOverlay;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.EditedMediaItemSequence;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.collect.ImmutableList;
import com.google.common.collect.ImmutableSet;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Media3 owns decoding/encoding: no WebView video element is used by this path. */
@UnstableApi
@CapacitorPlugin(name = "NativeExporter")
public class NativeExporterPlugin extends Plugin {
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private Transformer transformer;
  private PluginCall activeCall;
  private volatile boolean cancelled;
  private File output;
  private final List<Bitmap> bitmaps = new ArrayList<>();
  private Runnable progressPoll;

  private File sourceFile(String uri) throws Exception {
    File file = new File(Uri.parse(uri).getPath()).getCanonicalFile();
    String cache = getContext().getCacheDir().getCanonicalPath() + "/clipnova-native-";
    String durable = getContext().getFilesDir().getCanonicalPath() + "/clipnova-sources/";
    if ((!file.getPath().startsWith(cache) && !file.getPath().startsWith(durable)) || !file.isFile())
      throw new Exception("Invalid export source");
    return file;
  }
  private boolean hasAudio(File file) throws Exception {
    MediaExtractor ex = new MediaExtractor();
    try {
      ex.setDataSource(file.getAbsolutePath());
      for (int i = 0; i < ex.getTrackCount(); i++) {
        String mime = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME);
        if (mime != null && mime.startsWith("audio/")) return true;
      }
      return false;
    } finally { ex.release(); }
  }
  private EditedMediaItem item(JSONObject source, int width, int height, int fps) throws Exception {
    File file = sourceFile(source.getString("path"));
    boolean image = source.optBoolean("image");
    boolean audioOnly = source.getString("track").equals("audio");
    final float speed = (float)source.getDouble("speed");
    double start = source.getDouble("sourceStart"), end = source.getDouble("sourceEnd");
    if (!Float.isFinite(speed) || speed < .1f || speed > 10 || start < 0 || end <= start)
      throw new Exception("Invalid native clip timing");
    MediaItem.Builder media = new MediaItem.Builder().setUri(Uri.fromFile(file));
    if (image) media.setImageDurationMs(Math.round(source.getDouble("duration") * 1000));
    else media.setClippingConfiguration(new MediaItem.ClippingConfiguration.Builder()
      .setStartPositionMs(Math.round(start * 1000)).setEndPositionMs(Math.round(end * 1000)).build());
    List<AudioProcessor> processors = new ArrayList<>();
    ChannelMixingAudioProcessor stereo = new ChannelMixingAudioProcessor();
    stereo.putChannelMixingMatrix(ChannelMixingMatrix.createForConstantGain(1, 2));
    stereo.putChannelMixingMatrix(ChannelMixingMatrix.createForConstantGain(2, 2));
    processors.add(stereo);
    processors.add(new ExportGainProcessor((float)source.getDouble("volume"),
      source.optDouble("fadeIn"), source.optDouble("fadeOut"), source.getDouble("duration"), speed));
    List<Effect> visual = new ArrayList<>();
    if (!audioOnly) visual.add(Presentation.createForWidthAndHeight(width, height, Presentation.LAYOUT_STRETCH_TO_FIT));
    EditedMediaItem.Builder builder = new EditedMediaItem.Builder(media.build())
      .setRemoveVideo(audioOnly).setEffects(new Effects(processors, visual));
    if (image) builder.setFrameRate(fps);
    else builder.setSpeed(new SpeedProvider() {
      @Override public float getSpeed(long presentationTimeUs) { return speed; }
      @Override public long getNextSpeedChangeTimeUs(long timeUs) { return C.TIME_UNSET; }
    });
    return builder.build();
  }

  @PluginMethod public void exportVideo(PluginCall call) {
    main.post(() -> {
      if (activeCall != null) { call.reject("A native export is already running"); return; }
      if (Build.VERSION.SDK_INT < 29) { call.reject("Native gallery export requires Android 10 or later"); return; }
      activeCall = call; cancelled = false;
      worker.execute(() -> {
        try {
          JSONObject plan = call.getObject("plan");
          if (plan == null) throw new Exception("Missing export plan");
          int width = plan.getInt("width"), height = plan.getInt("height"), fps = plan.getInt("fps");
          if (width < 2 || height < 2 || width > 4096 || height > 4096 || fps < 1 || fps > 60)
            throw new Exception("Invalid output dimensions");
          JSONArray sources = plan.getJSONArray("sources");
          List<JSONObject> videoSources = new ArrayList<>(), audioSources = new ArrayList<>();
          boolean expectAudio = false;
          for (int i = 0; i < sources.length(); i++) {
            JSONObject s = sources.getJSONObject(i);
            if (s.getString("track").equals("audio")) audioSources.add(s); else videoSources.add(s);
            if (!s.optBoolean("image") && s.getDouble("volume") > 0 && hasAudio(sourceFile(s.getString("path")))) expectAudio = true;
          }
          videoSources.sort(Comparator.comparingDouble(s -> s.optDouble("start")));
          if (videoSources.isEmpty()) throw new Exception("No main-track source");
          List<EditedMediaItem> mainItems = new ArrayList<>();
          double end = 0;
          for (JSONObject s : videoSources) {
            if (Math.abs(s.getDouble("start") - end) > .02) throw new Exception("Native main-track gaps/overlaps are unsupported");
            mainItems.add(item(s, width, height, fps)); end += s.getDouble("duration");
          }
          List<EditedMediaItemSequence> sequences = new ArrayList<>();
          sequences.add(EditedMediaItemSequence.withAudioAndVideoFrom(mainItems));
          for (JSONObject s : audioSources) {
            EditedMediaItemSequence.Builder audio = new EditedMediaItemSequence.Builder(ImmutableSet.of(C.TRACK_TYPE_AUDIO));
            if (s.getDouble("start") > 0) audio.addGap(Math.round(s.getDouble("start") * 1000000));
            audio.addItem(item(s, width, height, fps));
            sequences.add(audio.build());
          }
          List<TextureOverlay> overlays = new ArrayList<>();
          JSONArray overlaySpecs = plan.getJSONArray("overlays");
          if ((long) overlaySpecs.length() * width * height * 4 > 32L * 1024 * 1024)
            throw new Exception("Native overlay bitmap memory limit (32 MB)");
          for (int i = 0; i < overlaySpecs.length(); i++) {
            JSONObject spec = overlaySpecs.getJSONObject(i);
            Bitmap bitmap = BitmapFactory.decodeFile(sourceFile(spec.getString("path")).getPath());
            if (bitmap == null) throw new Exception("Overlay bitmap cannot be decoded");
            bitmaps.add(bitmap);
            long startUs = Math.round(spec.getDouble("start") * 1000000);
            long endUs = Math.round(spec.getDouble("end") * 1000000);
            overlays.add(new BitmapOverlay() {
              @Override public Bitmap getBitmap(long timeUs) { return bitmap; }
              @Override public OverlaySettings getOverlaySettings(long timeUs) {
                return new StaticOverlaySettings.Builder().setAlphaScale(timeUs >= startUs && timeUs < endUs ? 1f : 0f).build();
              }
            });
          }
          Composition.Builder composition = new Composition.Builder(sequences);
          if (!overlays.isEmpty()) composition.setEffects(new Effects(ImmutableList.of(), ImmutableList.of(new OverlayEffect(overlays))));
          Composition ready = composition.build();
          output = File.createTempFile("clipnova-export-", ".mp4", getContext().getCacheDir());
          if (!output.delete()) throw new Exception("Cannot prepare export output");
          boolean requiredAudio = expectAudio;
          main.post(() -> start(call, plan, ready, requiredAudio));
        } catch (Exception e) { main.post(() -> fail(call, e)); }
      });
    });
  }

  private void start(PluginCall call, JSONObject plan, Composition composition, boolean expectAudio) {
    if (cancelled) { fail(call, new Exception("Export cancelled")); return; }
    try {
      transformer = new Transformer.Builder(getContext()).setVideoMimeType(MimeTypes.VIDEO_H264)
        .setAudioMimeType(MimeTypes.AUDIO_AAC).addListener(new Transformer.Listener() {
          @Override public void onCompleted(Composition composition, ExportResult result) {
            if (progressPoll != null) main.removeCallbacks(progressPoll);
            worker.execute(() -> {
              try {
                if (cancelled) throw new Exception("Export cancelled");
                JSObject verified = ExportFileInspector.inspect(output, plan.getDouble("duration"), expectAudio, plan.optBoolean("expectMotion"));
                if (cancelled) throw new Exception("Export cancelled");
                String name = plan.getString("name").replaceAll("[^a-zA-Z0-9_.-]", "_");
                Uri uri = publish(output, name);
                verified.put("uri", uri.toString()); verified.put("name", name);
                main.post(() -> {
                  if (activeCall == call) { call.resolve(verified); cleanup(); }
                });
              } catch (Exception e) { main.post(() -> fail(call, e)); }
            });
          }
          @Override public void onError(Composition composition, ExportResult result, ExportException exception) {
            fail(call, exception);
          }
        }).build();
      transformer.start(composition, output.getAbsolutePath());
      progressPoll = new Runnable() {
        @Override public void run() {
          if (activeCall != call || transformer == null) return;
          ProgressHolder holder = new ProgressHolder();
          if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
            JSObject event = new JSObject(); event.put("progress", Math.min(95, holder.progress));
            notifyListeners("progress", event);
          }
          main.postDelayed(this, 250);
        }
      };
      main.post(progressPoll);
    } catch (Exception e) { fail(call, e); }
  }

  private Uri publish(File file, String name) throws Exception {
    ContentValues values = new ContentValues();
    values.put(MediaStore.Video.Media.DISPLAY_NAME, name);
    values.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
    values.put(MediaStore.Video.Media.RELATIVE_PATH, "Movies/ClipNova");
    values.put(MediaStore.Video.Media.IS_PENDING, 1);
    Uri uri = getContext().getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
    if (uri == null) throw new Exception("MediaStore insert failed");
    boolean committed = false;
    try {
      long count = 0;
      try (FileInputStream in = new FileInputStream(file);
           OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
        if (out == null) throw new Exception("MediaStore stream unavailable");
        byte[] buffer = new byte[64 * 1024];
        int n;
        while ((n = in.read(buffer)) >= 0) {
          if (cancelled) throw new Exception("Export cancelled");
          out.write(buffer, 0, n); count += n;
        }
        out.flush();
      }
      if (count != file.length()) throw new Exception("Saved byte count mismatch");
      try (android.os.ParcelFileDescriptor fd = getContext().getContentResolver().openFileDescriptor(uri, "r")) {
        if (fd == null || fd.getStatSize() != file.length()) throw new Exception("Saved file size verification failed");
      }
      if (cancelled) throw new Exception("Export cancelled");
      ContentValues done = new ContentValues(); done.put(MediaStore.Video.Media.IS_PENDING, 0);
      if (getContext().getContentResolver().update(uri, done, null, null) != 1) throw new Exception("MediaStore publish failed");
      committed = true; return uri;
    } finally { if (!committed) getContext().getContentResolver().delete(uri, null, null); }
  }

  @PluginMethod public void cancel(PluginCall call) {
    cancelled = true;
    main.post(() -> {
      if (transformer != null) transformer.cancel();
      // Queue behind preparation/verification/copy so their files cannot be deleted while in use.
      worker.execute(() -> main.post(() -> {
        if (activeCall != null) fail(activeCall, new Exception("Export cancelled"));
        call.resolve();
      }));
    });
  }
  private void fail(PluginCall call, Exception e) {
    if (activeCall != call) return;
    call.reject("Native export: " + e.getMessage(), e); cleanup();
  }
  private void cleanup() {
    if (progressPoll != null) main.removeCallbacks(progressPoll);
    if (transformer != null) { transformer.cancel(); transformer = null; }
    for (Bitmap bitmap : bitmaps) if (!bitmap.isRecycled()) bitmap.recycle();
    bitmaps.clear();
    if (output != null) { output.delete(); output = null; }
    activeCall = null;
  }
  @Override protected void handleOnDestroy() {
    cancelled = true;
    main.post(() -> { if (transformer != null) transformer.cancel(); });
    worker.shutdown();
    super.handleOnDestroy();
  }
}
