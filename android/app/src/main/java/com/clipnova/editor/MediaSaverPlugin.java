package com.clipnova.editor;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.*;

@CapacitorPlugin(name = "MediaSaver")
public class MediaSaverPlugin extends Plugin {
  private static final class DocumentWrite {
    final Uri uri; final OutputStream stream; final long expected; long written;
    DocumentWrite(Uri uri, OutputStream stream, long expected) { this.uri = uri; this.stream = stream; this.expected = expected; }
  }
  private final java.util.Map<String, DocumentWrite> documents = new java.util.HashMap<>();
  private final java.util.concurrent.ExecutorService documentWorker = java.util.concurrent.Executors.newSingleThreadExecutor();
  /** Direct bridge streaming is reserved for failure to retain a Blob (e.g. full app storage). */
  @PluginMethod public void beginDocument(PluginCall call) {
    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType(call.getString("mimeType", "video/mp4"));
    intent.putExtra(Intent.EXTRA_TITLE, call.getString("displayName", "ClipNova.mp4"));
    startActivityForResult(call, intent, "streamDocumentCreated");
  }
  @ActivityCallback private void streamDocumentCreated(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
      call.reject("Save as cancelled; keep app open to retry"); return;
    }
    Uri uri = result.getData().getData();
    documentWorker.execute(() -> {
      try {
        persistDocumentAccess(uri, result.getData());
        OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "w");
        if (stream == null) throw new IOException("Document stream unavailable");
        String id = java.util.UUID.randomUUID().toString();
        documents.put(id, new DocumentWrite(uri, stream, call.getLong("expectedSize", 0L)));
        JSObject ret = new JSObject(); ret.put("id", id); ret.put("uri", uri.toString()); ret.put("sdkInt", Build.VERSION.SDK_INT); call.resolve(ret);
      } catch (Exception e) { call.reject("Save as could not open document: " + e, e); }
    });
  }
  @PluginMethod public void writeDocumentChunk(PluginCall call) {
    documentWorker.execute(() -> {
      try {
        DocumentWrite doc = documents.get(call.getString("id", ""));
        if (doc == null) throw new IOException("Document session missing");
        String data = call.getString("data", "");
        if (data.length() > 1500000) throw new IOException("Document chunk exceeds 1 MiB limit");
        byte[] bytes = android.util.Base64.decode(data, android.util.Base64.DEFAULT);
        if (doc.written + bytes.length > doc.expected) throw new IOException("Too many document bytes");
        doc.stream.write(bytes); doc.written += bytes.length;
        JSObject ret = new JSObject(); ret.put("written", doc.written); call.resolve(ret);
      } catch (Exception e) { call.reject("Document write failed: " + e, e); }
    });
  }
  @PluginMethod public void finishDocument(PluginCall call) {
    documentWorker.execute(() -> {
      DocumentWrite doc = documents.remove(call.getString("id", ""));
      try {
        if (doc == null) throw new IOException("Document session missing");
        doc.stream.close();
        JSObject query = inspect(doc.uri, doc.expected);
        if (doc.written != doc.expected || !query.getBoolean("verified", false)) throw new IOException("Document size verification failed: " + query);
        JSObject ret = result(doc.uri, doc.written, "document"); ret.put("query", query); call.resolve(ret);
      } catch (Exception e) { call.reject("Document finish failed: " + e, e); }
    });
  }
  @PluginMethod public void abortDocument(PluginCall call) {
    documentWorker.execute(() -> {
      DocumentWrite doc = documents.remove(call.getString("id", ""));
      if (doc != null) {
        try { doc.stream.close(); } catch (Exception ignored) {}
        try { getContext().getContentResolver().delete(doc.uri, null, null); } catch (Exception ignored) {}
      }
      call.resolve();
    });
  }

  private File exportFile(PluginCall call) throws Exception {
    String path = call.getString("path");
    if (path == null) throw new IOException("Finished export path required");
    File src = new File(Uri.parse(path).getScheme() == null ? path : Uri.parse(path).getPath()).getCanonicalFile();
    String cache = new File(getContext().getCacheDir(), "clipnova-exports").getCanonicalPath() + "/";
    String durable = new File(getContext().getFilesDir(), "clipnova-outputs").getCanonicalPath() + "/";
    if ((!src.getPath().startsWith(cache) && !src.getPath().startsWith(durable)) || !src.isFile())
      throw new IOException("MediaSaver accepts only finished export files");
    long expected = call.getLong("expectedSize", 0L);
    if (expected <= 0 || src.length() != expected) throw new IOException("Input size mismatch: " + src.length() + "/" + expected);
    return src;
  }

  @PluginMethod public void saveVideo(PluginCall call) {
    new Thread(() -> {
      JSObject diagnostic = new JSObject();
      diagnostic.put("method", "mediastore"); diagnostic.put("apiLevel", Build.VERSION.SDK_INT);
      diagnostic.put("requestedDisplayName", call.getString("displayName")); diagnostic.put("bytesWritten", 0);
      diagnostic.put("expectedSize", call.getLong("expectedSize", 0L));
      try {
        File src = exportFile(call);
        String name = ExportNames.unique(call.getString("displayName", "ClipNova.mp4"));
        diagnostic.put("displayName", name);
        String mime = call.getString("mimeType", "video/mp4");
        if (Build.VERSION.SDK_INT < 29) { saveLegacy(call, src, name, mime); return; }
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Video.Media.DISPLAY_NAME, name);
        values.put(MediaStore.Video.Media.MIME_TYPE, mime);
        values.put(MediaStore.Video.Media.RELATIVE_PATH, "Movies/ClipNova");
        values.put(MediaStore.Video.Media.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
        diagnostic.put("uri", uri == null ? org.json.JSONObject.NULL : uri.toString());
        if (uri == null) throw new IOException("MediaStore insert returned null URI");
        boolean published = false;
        try {
          long written;
          try (OutputStream out = resolver.openOutputStream(uri, "w")) {
            if (out == null) throw new IOException("MediaStore output stream is null: " + uri);
            written = copyFile(src, out, diagnostic);
          }
          if (written != src.length()) throw new IOException("MediaStore copy size mismatch: " + written + "/" + src.length());
          ContentValues done = new ContentValues(); done.put(MediaStore.Video.Media.IS_PENDING, 0);
          if (resolver.update(uri, done, null, null) != 1) throw new IOException("MediaStore publish update failed: " + uri);
          JSObject query = inspect(uri, src.length());
          diagnostic.put("query", query);
          if (!query.getBoolean("verified", false)) throw new IOException("MediaStore verification failed: " + query);
          published = true;
          JSObject result = result(uri, written, "mediastore");
          result.put("relativePath", "Movies/ClipNova/" + query.getString("displayName", name));
          result.put("query", query); call.resolve(result);
        } finally {
          // Only the new output row belongs to this operation. Never delete src.
          if (!published) resolver.delete(uri, null, null);
        }
      } catch (Exception e) { diagnostic.put("exception", e.toString()); call.reject("Save failed: " + diagnostic, e); }
    }, "ClipNova-save").start();
  }

  private void saveLegacy(PluginCall call, File src, String name, String mime) throws Exception {
    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "ClipNova");
    if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create Movies/ClipNova");
    File dst = new File(dir, name);
    // Atomic reservation: never overwrite, including a collision with an existing name.
    while (!dst.createNewFile()) { name = ExportNames.unique(name); dst = new File(dir, name); }
    boolean complete = false;
    try {
      long written;
      try (OutputStream out = new FileOutputStream(dst)) { written = copyFile(src, out); }
      if (written != src.length() || dst.length() != src.length()) throw new IOException("Legacy save size mismatch");
      final File saved = dst; complete = true;
      android.media.MediaScannerConnection.scanFile(getContext(), new String[]{dst.getAbsolutePath()}, new String[]{mime}, (path, uri) -> {
        JSObject result = result(uri != null ? uri : Uri.fromFile(saved), saved.length(), "legacy-public-movies");
        result.put("relativePath", "Movies/ClipNova/" + saved.getName()); call.resolve(result);
      });
    } finally { if (!complete) dst.delete(); }
  }

  @PluginMethod public void saveAs(PluginCall call) {
    try {
      exportFile(call);
      Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType(call.getString("mimeType", "video/mp4"));
      intent.putExtra(Intent.EXTRA_TITLE, call.getString("displayName", "ClipNova.mp4"));
      startActivityForResult(call, intent, "documentCreated");
    } catch (Exception e) { call.reject("Save as failed: " + e, e); }
  }
  @ActivityCallback private void documentCreated(PluginCall call, ActivityResult activityResult) {
    if (call == null) return;
    if (activityResult.getResultCode() != Activity.RESULT_OK || activityResult.getData() == null || activityResult.getData().getData() == null) {
      call.reject("Save as cancelled; finished output retained in My exports"); return;
    }
    Uri uri = activityResult.getData().getData();
    new Thread(() -> {
      try {
        persistDocumentAccess(uri, activityResult.getData());
        File src = exportFile(call); long written;
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "w")) {
          if (out == null) throw new IOException("Document output stream is null");
          written = copyFile(src, out);
        }
        JSObject query = inspect(uri, src.length());
        if (written != src.length() || !query.getBoolean("verified", false)) throw new IOException("Document verification failed: " + query);
        JSObject result = result(uri, written, "document"); result.put("query", query); call.resolve(result);
      } catch (Exception e) { call.reject("Save as failed; output retained: " + e, e); }
    }, "ClipNova-save-as").start();
  }
  private void persistDocumentAccess(Uri uri, Intent data) throws IOException {
    int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
    if (flags == 0) flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    try { getContext().getContentResolver().takePersistableUriPermission(uri, flags); }
    catch (SecurityException e) { throw new IOException("Cannot retain access to this document after restart; choose another folder", e); }
  }
  private JSObject result(Uri uri, long size, String method) {
    JSObject result = new JSObject(); result.put("uri", uri.toString()); result.put("size", size);
    result.put("method", method); result.put("sdkInt", Build.VERSION.SDK_INT); return result;
  }
  private JSObject inspect(Uri uri, long expected) throws Exception {
    long actual = -1; int pending = 0; boolean exists = false; String name = "";
    if ("file".equals(uri.getScheme())) {
      File file = new File(uri.getPath()); exists = file.isFile(); actual = exists ? file.length() : -1; name = file.getName();
    } else {
      boolean media = "media".equals(uri.getAuthority()) && Build.VERSION.SDK_INT >= 29;
      String[] columns = media ? new String[]{OpenableColumns.SIZE, OpenableColumns.DISPLAY_NAME, MediaStore.MediaColumns.IS_PENDING}
        : new String[]{OpenableColumns.SIZE, OpenableColumns.DISPLAY_NAME};
      try (Cursor cursor = getContext().getContentResolver().query(uri, columns, null, null, null)) {
        if (cursor != null && cursor.moveToFirst()) {
          exists = true; actual = cursor.isNull(0) ? -1 : cursor.getLong(0); name = cursor.getString(1);
          if (media) pending = cursor.getInt(2);
        }
      }
      try (android.os.ParcelFileDescriptor fd = getContext().getContentResolver().openFileDescriptor(uri, "r")) {
        if (fd == null) exists = false;
        else if (actual < 0) actual = fd.getStatSize();
      }
    }
    JSObject result = new JSObject(); result.put("uri", uri.toString()); result.put("exists", exists);
    result.put("actualSize", actual); result.put("expectedSize", expected); result.put("pending", pending);
    result.put("displayName", name); result.put("verified", exists && expected > 0 && actual == expected && pending == 0); return result;
  }
  @PluginMethod public void verifySize(PluginCall call) {
    new Thread(() -> {
      try { call.resolve(inspect(Uri.parse(call.getString("uri", "")), call.getLong("expectedSize", 0L))); }
      catch (Exception e) { call.reject("Saved file query failed: " + e, e); }
    }, "ClipNova-verify-save").start();
  }
  private Uri readableUri(String value) {
    Uri uri = Uri.parse(value);
    return "file".equals(uri.getScheme()) ? FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", new File(uri.getPath())) : uri;
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
    intent.setDataAndType(readableUri(uriString), mimeType);
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
    intent.putExtra(Intent.EXTRA_STREAM, readableUri(uriString));
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


  private static long copyFile(File src, OutputStream out) throws IOException { return copyFile(src, out, null); }
  private static long copyFile(File src, OutputStream out, JSObject diagnostic) throws IOException {
    long total = 0; byte[] bytes = new byte[64 * 1024];
    try (InputStream in = new FileInputStream(src)) {
      int n; while ((n = in.read(bytes)) != -1) { out.write(bytes, 0, n); total += n; if (diagnostic != null) diagnostic.put("bytesWritten", total); }
    }
    out.flush(); return total;
  }
}
