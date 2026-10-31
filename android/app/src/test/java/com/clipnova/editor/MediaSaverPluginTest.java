package com.clipnova.editor;

import static org.junit.Assert.*;
import android.content.*;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContentResolver;

/** Real PluginCall/JSONObject number conversion; only the Android provider is fake. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {29, 36}, manifest = Config.NONE)
public class MediaSaverPluginTest {
  private Context context;
  private MediaSaverPlugin plugin;
  private FakeMediaProvider provider;
  private File source;
  private JSObject payload;

  static final class Call extends PluginCall {
    final CountDownLatch finished = new CountDownLatch(1);
    volatile JSObject value; volatile String error;
    Call(String method, JSObject data) { super(null, "MediaSaver", "test", method, data); }
    @Override public void resolve(JSObject data) { value = data; finished.countDown(); }
    @Override public void reject(String msg, String code, Exception ex, JSObject data) { error = msg; finished.countDown(); }
    void await() throws Exception { assertTrue("Plugin did not finish", finished.await(15, TimeUnit.SECONDS)); }
  }

  @Before public void setUp() throws Exception {
    context = RuntimeEnvironment.getApplication();
    plugin = new MediaSaverPlugin() { @Override public Context getContext() { return context; } };
    provider = new FakeMediaProvider();
    ProviderInfo info = new ProviderInfo(); info.authority = "media";
    provider.attachInfo(context, info);
    ShadowContentResolver.registerProviderInternal("media", provider);
    try (InputStream in = getClass().getClassLoader().getResourceAsStream("media-save-request.json")) {
      assertNotNull("Shared JS/native contract fixture", in);
      payload = new JSObject(new String(in.readAllBytes(), StandardCharsets.UTF_8));
    }
    source = new File(context.getFilesDir(), "clipnova-outputs/Project 1-1080p.mp4");
    assertTrue(source.getParentFile().isDirectory() || source.getParentFile().mkdirs());
    byte[] bytes = new byte[payload.getInt("expectedSize")];
    for (int i = 0; i < bytes.length; i++) bytes[i] = (byte)(i * 31);
    try (OutputStream out = new FileOutputStream(source)) { out.write(bytes); out.flush(); }
    payload.put("path", source.getAbsolutePath());
  }

  private void saveAndVerify() throws Exception {
    Call call = new Call("saveVideo", payload); plugin.saveVideo(call); call.await();
    assertNull(call.error, call.error); assertNotNull(call.value);
    assertEquals(source.length(), call.value.getLong("size"));
    assertEquals(Build.VERSION.SDK_INT, call.value.getInt("sdkInt"));
    Uri uri = Uri.parse(call.value.getString("uri")); FakeMediaProvider.Row row = provider.rows.get(uri);
    assertNotNull(row); assertEquals(0, row.pending);
    assertEquals("Movies/ClipNova", row.relativePath);
    assertArrayEquals(Files.readAllBytes(source.toPath()), Files.readAllBytes(row.file.toPath()));
    JSObject query = new JSObject("{\"uri\":\"" + uri + "\",\"expectedSize\":" + source.length() + "}");
    Call verify = new Call("verifySize", query); plugin.verifySize(verify); verify.await();
    assertNull(verify.error, verify.error); assertTrue(verify.value.getBoolean("verified", false));
    assertEquals(source.length(), verify.value.getLong("actualSize"));
    assertTrue(source.isFile()); assertEquals(7388734, source.length());
  }

  @Test public void javascriptIntegerPayloadCopiesSevenMegabytes() throws Exception {
    assertTrue(payload.opt("expectedSize") instanceof Integer);
    saveAndVerify();
  }
  @Test public void missingExpectedSizeUsesRealFile() throws Exception { payload.remove("expectedSize"); saveAndVerify(); }
  @Test public void zeroExpectedSizeUsesRealFile() throws Exception { payload.put("expectedSize", 0); saveAndVerify(); }
  @Test public void decimalJsonNumberIsAcceptedWithoutNarrowing() throws Exception { payload.put("expectedSize", 7388734.0); saveAndVerify(); }
  @Test public void encodedFileUriAndSpacesResolveOnce() throws Exception { payload.put("path", Uri.fromFile(source).toString()); saveAndVerify(); }
  @Test public void cacheOutputIsAlsoReadable() throws Exception {
    File cache = new File(context.getCacheDir(), "clipnova-exports/cache-output.mp4");
    assertTrue(cache.getParentFile().isDirectory() || cache.getParentFile().mkdirs());
    Files.copy(source.toPath(), cache.toPath()); source = cache; payload.put("path", source.getAbsolutePath()); saveAndVerify();
  }
  @Test public void wrongPositiveExpectedSizeIsExplicitAndDoesNotInsert() throws Exception {
    payload.put("expectedSize", 7388735);
    Call call = new Call("saveVideo", payload); plugin.saveVideo(call); call.await();
    assertNull(call.value); assertNotNull(call.error);
    assertTrue(call.error, call.error.contains("actual=7388734") && call.error.contains("expected=7388735"));
    assertTrue(provider.rows.isEmpty()); assertTrue(source.isFile());
  }
  @Test public void longExpectedSizeIsNotTruncatedToInt() throws Exception {
    payload.put("expectedSize", 4294967296L);
    Call call = new Call("saveVideo", payload); plugin.saveVideo(call); call.await();
    assertTrue(call.error, call.error.contains("expected=4294967296")); assertTrue(provider.rows.isEmpty());
  }
  @Test public void nullInsertIsClassifiedForSystemPickerFallback() throws Exception {
    provider.nullInsert = true;
    Call call = new Call("saveVideo", payload); plugin.saveVideo(call); call.await();
    assertTrue(call.error, call.error.contains("MEDIASTORE_INSERT_FAILED")); assertTrue(source.isFile());
  }
  @Test public void rowMismatchDeletesOnlyNewOutputAndRetainsInput() throws Exception {
    provider.wrongSize = true;
    Call call = new Call("saveVideo", payload); plugin.saveVideo(call); call.await();
    assertNotNull(call.error); assertTrue(call.error, call.error.contains("verification failed"));
    assertEquals(1, provider.deleted); assertTrue(provider.rows.isEmpty()); assertTrue(source.isFile());
  }

  public static class FakeMediaProvider extends ContentProvider {
    static final class Row { File file; String name; String relativePath; int pending; }
    final Map<Uri, Row> rows = new HashMap<>();
    boolean nullInsert, wrongSize; int deleted;
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "video/mp4"; }
    @Override public Uri insert(Uri uri, ContentValues values) {
      if (nullInsert) return null;
      try {
        Row row = new Row(); row.file = File.createTempFile("media-", ".mp4", getContext().getCacheDir());
        row.name = values.getAsString(MediaStore.MediaColumns.DISPLAY_NAME);
        row.relativePath = values.getAsString(MediaStore.MediaColumns.RELATIVE_PATH);
        row.pending = values.getAsInteger(MediaStore.MediaColumns.IS_PENDING);
        Uri created = Uri.parse("content://media/external/video/media/" + UUID.randomUUID()); rows.put(created, row); return created;
      } catch (IOException e) { throw new IllegalStateException(e); }
    }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) {
      rows.get(uri).pending = values.getAsInteger(MediaStore.MediaColumns.IS_PENDING); return 1;
    }
    @Override public Cursor query(Uri uri, String[] columns, String selection, String[] args, String order) {
      MatrixCursor cursor = new MatrixCursor(columns); Row row = rows.get(uri); if (row == null) return cursor;
      Object[] values = new Object[columns.length];
      for (int i = 0; i < columns.length; i++) {
        if (OpenableColumns.SIZE.equals(columns[i])) values[i] = row.file.length() + (wrongSize ? 1 : 0);
        else if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) values[i] = row.name;
        else if (MediaStore.MediaColumns.IS_PENDING.equals(columns[i])) values[i] = row.pending;
        else throw new IllegalArgumentException(columns[i]);
      }
      cursor.addRow(values); return cursor;
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
      return ParcelFileDescriptor.open(rows.get(uri).file, ParcelFileDescriptor.parseMode(mode));
    }
    @Override public int delete(Uri uri, String selection, String[] args) {
      Row row = rows.remove(uri); if (row == null) return 0; row.file.delete(); deleted++; return 1;
    }
  }
}
