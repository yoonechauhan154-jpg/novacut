# PR 1: Android Gallery size contract

## Phone-tested APK and scope

The speed/save APK from run #95 has Settings build ID **ae8871d** (PR merge commit ae8871d9e77a32396151892925d99eade074ccf6, branch commit 38476b29f993039d3574719ef3f3168e061186c2).
It includes speed timeline/preview/export/audio/split/undo changes. Run #95 passed 47 browser tests, native unit tests and APK assembly. The phone has now confirmed rendering with effects: 266 frames, 7,388,734 bytes, 8.87 seconds, changing frames and audio. Gallery publication failed; rendering success is not evidence of a saved Gallery file.

This follow-up remains on PR 1. No Phase 2 work or main changes.

## Root cause, with baseline evidence

Baseline links below use the exact branch commit from the supplied APK:

- [androidBridge.ts line 355](https://github.com/yoonechauhan154-jpg/novacut/blob/38476b29f993039d3574719ef3f3168e061186c2/src/utils/androidBridge.ts#L355) sends a JavaScript number named **expectedSize**. The name matches Java; this is not a spelling mismatch.
- [MediaSaverPlugin.java lines 101–102](https://github.com/yoonechauhan154-jpg/novacut/blob/38476b29f993039d3574719ef3f3168e061186c2/android/app/src/main/java/com/clipnova/editor/MediaSaverPlugin.java#L101) uses **PluginCall.getLong("expectedSize", 0L)** and rejects zero. Capacitor's typed getter accepts Long only. Android JSON represents 7388734 as Integer, so the default zero is used. The same incorrect accessor appears in the diagnostic (111), direct-document session (51), and verification (236).
- In **Input size mismatch: 7388734/0**, the first value is **File.length(): actual input bytes**; the second is **the parsed expected size**. The file had not been copied yet: bytesWritten=0. The failure occurs before MediaStore insertion.
- [androidBridge.ts line 374](https://github.com/yoonechauhan154-jpg/novacut/blob/38476b29f993039d3574719ef3f3168e061186c2/src/utils/androidBridge.ts#L374) looks for prose matching “API 36”; the native error instead contains JSON apiLevel:36. It does not promote that field to the outer diagnostic.
- Line 355 also removes the file:// prefix without decoding percent-encoded characters. This is a separate path defect for filenames containing spaces or percent signs, not the cause of this phone's size-zero failure.

## Changes

MediaSaver now accepts Number-backed whole byte counts without int narrowing, rejects strings/fractions/negative or unsafe values, and uses File.length as the authoritative size. Missing/null/zero hints are accepted for retained files; an incorrect positive hint is rejected with labeled actual/expected bytes. Streaming and explicit verification still require positive sizes because they cannot infer a completed input file.

The retained file is canonicalized under files/clipnova-outputs or cache/clipnova-exports. Both raw absolute paths and file URIs are supported; URI characters are decoded once. Imported source locations are not accepted. Retention awaits all chunk writes and stats the file before publication. Native copy uses a 64 KiB buffer, flushes, and closes before publication/query.

Android 10+ still inserts Movies/ClipNova with IS_PENDING=1, closes the copied file, checks byte count against the initial input length, clears IS_PENDING with a checked update, and queries existence/size/pending. Failed rows are deleted; the input file is retained. Insert null/exception failures receive MEDIASTORE_INSERT_FAILED so JavaScript can automatically open ACTION_CREATE_DOCUMENT, display an English/Hindi notice, and record the actual chosen URI rather than claiming Movies/ClipNova.

getInfo reports Build.VERSION.SDK_INT. Success and error diagnostics carry the API level, exact input bytes, expected type/value, written bytes, and query. The existing Playback log and Copy controls include these records. My exports retains the real destination, method and API level.

## Regression tests and limits

contracts/media-save-request.json is the shared JS/native payload fixture. Playwright records actual bridge arguments and checks exact keys, numeric bytes and decoded path, API-level error propagation, automatic Save as and cancellation. Robolectric calls the actual MediaSaverPlugin.saveVideo and verifySize methods using real PluginCall/JSON parsing and a file-backed fake ContentProvider on API 29 and 36. Tests use a 7,388,734-byte file, byte-for-byte output comparison, missing/zero/double/long size cases, wrong positive size, raw/cache/encoded paths, null insert and bad queried size. The fake provider tests publication logic, not an OEM Gallery or system picker.

Validation run links and final counts are recorded in the PR. No device success claim is made before a phone retest. Existing speed and source-lifetime tests remain enabled.

## Phone checklist

1. Check Settings build ID against the new APK link in PR 1.
2. Export a video with effects three times. Confirm automatic saving; tap Save to Gallery when offered. Check three distinct files in Gallery and Files > Movies/ClipNova, and saved entries in Settings > My exports.
3. Open/share the files and close/reopen the app. If saving fails, copy diagnostics: the outer API level should be 36 and expectedSize/inputSize/written bytes should be meaningful.
4. If the system Save as picker appears, choose a folder. Confirm the displayed destination is the chosen file. Cancellation must retain the app copy for retry.
5. For a 10-second source, preview/export at 0.5x (about 20 seconds) and 2x (about 5 seconds). Check motion/audio synchronization, split and undo.

Actual Android 10–16 MediaStore providers, Gallery indexing, system-picker permissions, native Media3 encoding and speed/audio quality on the user's phone still require device testing.
