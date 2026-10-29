package com.clipnova.editor;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Saves an exported video into the public MediaStore (Movies/ClipNova) so it
 * shows up in the Gallery and Files app on Android 10 (API 29) through 15.
 *
 * No storage permission is required on API 29+: the file is inserted through
 * MediaStore.Video.Media with IS_PENDING=1, streamed in, then published with
 * IS_PENDING=0. On API 28 and below it falls back to the public Movies directory
 * (WRITE_EXTERNAL_STORAGE must be granted) plus MediaScannerConnection.
 *
 * The caller (WebView) writes the blob into the app cache directory in chunks
 * and passes the cache file path here; this plugin copies it into MediaStore and
 * leaves input cleanup to its caller. It never deletes a source file.
 */
@CapacitorPlugin(name = "MediaSaver")
public class MediaSaverPlugin extends Plugin {

  @PluginMethod
  public void saveVideo(PluginCall call) {
    String path = call.getString("path");
    String displayName = call.getString("displayName", "export.mp4");
    String mimeType = call.getString("mimeType", "video/mp4");
    long expectedSize = call.getLong("expectedSize", 0L);

    if (path == null || path.isEmpty()) {
      call.reject("path is required");
      return;
    }

    Activity activity = getActivity();
    if (activity == null) {
      call.reject("No activity available");
      return;
    }

    final File src;
    try {
      src = new File(path).getCanonicalFile();
      String exportRoot = new File(getContext().getCacheDir(), "clipnova-exports").getCanonicalPath() + File.separator;
      if (!src.getPath().startsWith(exportRoot)) {
        call.reject("MediaSaver accepts only export-owned cache files");
        return;
      }
    } catch (IOException e) {
      call.reject("Invalid export cache path", e);
      return;
    }
    if (!src.exists()) {
      call.reject("Source file not found: " + path);
      return;
    }

    // Do the potentially large file copy off the UI thread.
    new Thread(() -> {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          saveViaMediaStore(activity, call, src, displayName, mimeType, expectedSize);
        } else {
          saveLegacy(activity, call, src, displayName, mimeType, expectedSize);
        }
      } catch (Exception e) {
        call.reject("Save failed: " + e.getMessage(), e);
      }
    }).start();
  }

  private void saveViaMediaStore(Activity activity, PluginCall call, File src, String displayName, String mimeType, long expectedSize) throws Exception {
    ContentResolver resolver = activity.getContentResolver();
    ContentValues values = new ContentValues();
    values.put(MediaStore.Video.Media.DISPLAY_NAME, displayName);
    values.put(MediaStore.Video.Media.MIME_TYPE, mimeType);
    values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/ClipNova");
    values.put(MediaStore.Video.Media.IS_PENDING, 1);

    Uri uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
    if (uri == null) {
      throw new Exception("MediaStore insert returned null URI");
    }

    long written = 0;
    OutputStream out = null;
    try {
      out = resolver.openOutputStream(uri);
      if (out == null) {
        throw new Exception("Could not open MediaStore output stream for " + uri);
      }
      written = copyFile(src, out);
      out.flush();
    } finally {
      if (out != null) {
        try { out.close(); } catch (IOException ignored) {}
      }
    }

    // Publish to the media store and record the byte count.
    ContentValues update = new ContentValues();
    update.put(MediaStore.Video.Media.IS_PENDING, 0);
    update.put(MediaStore.Video.Media.SIZE, written);
    resolver.update(uri, update, null, null);

    JSObject ret = new JSObject();
    ret.put("uri", uri.toString());
    ret.put("size", written);
    ret.put("expectedSize", expectedSize);
    ret.put("relativePath", "Movies/ClipNova/" + displayName);
    ret.put("method", "mediastore");
    ret.put("sdkInt", (long) Build.VERSION.SDK_INT);
    call.resolve(ret);
  }

  private void saveLegacy(Activity activity, PluginCall call, File src, String displayName, String mimeType, long expectedSize) throws Exception {
    if (ContextCompat.checkSelfPermission(activity, android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
        != PackageManager.PERMISSION_GRANTED) {
      call.reject("WRITE_EXTERNAL_STORAGE permission is required on Android 9 and below");
      return;
    }

    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "ClipNova");
    if (!dir.isDirectory() && !dir.mkdirs()) {
      throw new Exception("Could not create Movies/ClipNova directory");
    }

    File out = new File(dir, displayName);
    long written = 0;
    OutputStream os = null;
    try {
      os = new FileOutputStream(out);
      written = copyFile(src, os);
      os.flush();
    } finally {
      if (os != null) {
        try { os.close(); } catch (IOException ignored) {}
      }
    }

    android.media.MediaScannerConnection.scanFile(
        activity,
        new String[] { out.getAbsolutePath() },
        new String[] { mimeType },
        null);

    JSObject ret = new JSObject();
    ret.put("uri", Uri.fromFile(out).toString());
    ret.put("size", written);
    ret.put("expectedSize", expectedSize);
    ret.put("relativePath", "Movies/ClipNova/" + displayName);
    ret.put("method", "legacy-public-movies");
    ret.put("sdkInt", (long) Build.VERSION.SDK_INT);
    call.resolve(ret);
  }

  @PluginMethod
  public void verifySize(PluginCall call) {
    String uriString = call.getString("uri");
    long expectedSize = call.getLong("expectedSize", 0L);
    if (uriString == null || uriString.isEmpty()) {
      call.reject("uri is required");
      return;
    }
    Uri uri = Uri.parse(uriString);
    ContentResolver resolver = getActivity().getContentResolver();
    long actualSize = -1;
    Cursor c = null;
    try {
      c = resolver.query(uri, new String[]{MediaStore.Video.Media.SIZE}, null, null, null);
      if (c != null && c.moveToFirst()) {
        actualSize = c.getLong(0);
      }
    } finally {
      if (c != null) {
        c.close();
      }
    }
    JSObject ret = new JSObject();
    ret.put("uri", uriString);
    ret.put("actualSize", actualSize);
    ret.put("expectedSize", expectedSize);
    ret.put("verified", actualSize >= 0 && actualSize == expectedSize);
    call.resolve(ret);
  }

  @PluginMethod
  public void openUri(PluginCall call) {
    String uriString = call.getString("uri");
    String mimeType = call.getString("mimeType", "video/mp4");
    Activity activity = getActivity();
    if (activity == null || uriString == null) {
      call.reject("uri and activity required");
      return;
    }
    Intent intent = new Intent(Intent.ACTION_VIEW);
    intent.setDataAndType(Uri.parse(uriString), mimeType);
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_CLEAR_WHEN_TASK_RESET);
    try {
      activity.startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject("Open failed: " + e.getMessage(), e);
    }
  }

  @PluginMethod
  public void shareUri(PluginCall call) {
    String uriString = call.getString("uri");
    String title = call.getString("title", "ClipNova");
    String text = call.getString("text", "Exported from ClipNova");
    String mimeType = call.getString("mimeType", "video/mp4");
    Activity activity = getActivity();
    if (activity == null || uriString == null) {
      call.reject("uri and activity required");
      return;
    }
    Intent intent = new Intent(Intent.ACTION_SEND);
    intent.setType(mimeType);
    intent.putExtra(Intent.EXTRA_STREAM, Uri.parse(uriString));
    intent.putExtra(Intent.EXTRA_TITLE, title);
    intent.putExtra(Intent.EXTRA_TEXT, text);
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    try {
      activity.startActivity(Intent.createChooser(intent, title));
      call.resolve();
    } catch (Exception e) {
      call.reject("Share failed: " + e.getMessage(), e);
    }
  }

  /** Copies src into out, returning total bytes written. */
  private static long copyFile(File src, OutputStream out) throws IOException {
    long total = 0;
    byte[] buf = new byte[16384];
    try (InputStream in = new FileInputStream(src)) {
      int n;
      while ((n = in.read(buf)) > 0) {
        out.write(buf, 0, n);
        total += n;
      }
    }
    out.flush();
    return total;
  }
}
