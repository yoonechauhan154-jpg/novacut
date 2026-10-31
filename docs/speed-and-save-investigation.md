# PR 1 follow-up: speed and finding the finished file

The user verified build `6e5ba8a` on a phone: repeated exports, splits and transitions now worked. This follow-up addresses speed and saving only. It does not start Phase 2.

## What was wrong

Evidence below is pinned to the phone-tested PR head `956f7b991f83332531cee183a207e5501ed1351e`.

| Finding | Code evidence |
| --- | --- |
| The speed slider changed only `clip.speed`. It did not change timeline duration or shift following clips. Its RAF update also bypassed undo history. The available range was only 0.2–4x. | [App.tsx:5030](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/App.tsx#L5030), [updater:1131](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/App.tsx#L1131) |
| Preview calculated a speed-adjusted target time, but did not assign playbackRate to its video/audio elements. Continuous playback therefore continued at 1x. | [App.tsx:821](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/App.tsx#L821), [video:885](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/App.tsx#L885), [visible preview:989](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/App.tsx#L989) |
| Paused canvas preview used a modulo calculation instead of a bounded source interval and ignored reverse. Split always used forward source-range math. | [canvasRenderer.ts:843](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/utils/canvasRenderer.ts#L843), [App.tsx:1614](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/App.tsx#L1614) |
| Export frame mapping already multiplied by speed, but the timeline length was unchanged. Offline audio changed rate and pitch together and did not reverse samples. Curve buttons were not wired to real source retiming. | [exportMedia.ts:165](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/export/exportMedia.ts#L165), [exportEngine.ts:265](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/export/exportEngine.ts#L265), [curve UI:5042](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/App.tsx#L5042) |
| WebView export completion only stored an in-memory Blob/URL. It did not save automatically or add an entry to My exports. Native completion took a different, already-saved branch. Effects can require the WebView path, so “render complete” was not evidence of a public file. | [App.tsx:2239](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/App.tsx#L2239) |
| Gallery save required a separate click, reused project/resolution names, and only added successful saves to My exports. Starting another render cleared the previous in-memory output. | [App.tsx:2366](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/App.tsx#L2366), [cleanup:2223](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/App.tsx#L2223) |
| Save outcome state existed but no save-status dialog rendered it; its JSX uses only disabled the two buttons while saving. A size mismatch was returned with saved=true, and App checked only saved. | [App.tsx:369](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/App.tsx#L369), [button:5570](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/App.tsx#L5570), [androidBridge.ts:329](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/src/utils/androidBridge.ts#L329) |
| MediaSaver set IS_PENDING=0, but did not check the update count or query that flag afterward. Its verifier queried only size. | [MediaSaverPlugin.java:124](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/android/app/src/main/java/com/clipnova/editor/MediaSaverPlugin.java#L124), [query:190](https://github.com/yoonechauhan154-jpg/novacut/blob/956f7b991f83332531cee183a207e5501ed1351e/android/app/src/main/java/com/clipnova/editor/MediaSaverPlugin.java#L190) |

No source deletion was found in these save paths. A duplicate display name alone is not proof that MediaStore caused the particular phone failure; the missing automatic save, missing visible outcome and false success on size mismatch are confirmed code defects. The exact device-side exception for the reported effects-heavy export was not supplied and cannot be reconstructed from “Render complete.”

Native speed was not absent: the old plugin used Media3 1.9 setSpeed. This follow-up makes the audio/video effects and keep-pitch choice explicit, rather than claiming that method itself was broken.

## Behavior in this follow-up

- One source-time function drives scrubbing, preview, fullscreen, reverse, split and export. In/out points remain original-media seconds.
- Speed has 0.1–10x range, the requested nine presets, reset, undo/redo and keep-pitch. The unimplemented curve buttons are removed.
- Duration is (sourceEnd-sourceStart)/speed. Main-video edits shift subsequent clips on all tracks. Text, sticker, adjustment and effect layers spanning the changed interval follow its new timing. Independent audio/PIP keep their own speed; later ones shift with the cut. Independent audio/PIP edits ripple their own track.
- Old projects whose speed changed without changing duration are normalized from their source interval when opened.
- Audio is processed in a bundled worker. Preview also uses processed audio for reverse and rates outside 0.25–4x, where media elements may mute sound. Keep-pitch uses waveform overlap alignment; disabling it resamples. Reverse reverses the selected samples. The mixed audio has the same timeline sample count as video.
- Native constant speed uses SpeedChangeEffect and SonicAudioProcessor in EditedMediaItem Effects. There is one speed operation per stream; pitch is 1 when keep-pitch is on and speed when off. Native still refuses reverse and unsupported effects/transitions rather than dropping edits.
- Verified output is retained in app-private `clipnova-outputs/` (Android) or a separate IndexedDB output store (browser), distinct from imported sources.
- Android automatically copies the retained output to Movies/ClipNova under a unique name. Success requires a returned URI, matching written/query size, an existing row and IS_PENDING=0.
- My exports records saved/not-saved/failed entries and actual URIs, with retry, Open, Share and explicit app-copy discard. Saving never deletes an imported source.
- A visible status dialog distinguishes render completion from public saving. It includes the destination, size, error, Copy diagnostics and system Save as.
- ACTION_CREATE_DOCUMENT normally copies the retained file. If app storage itself is full, a bounded chunk stream can write the still-live Blob directly to the chosen document. The app prevents another render from discarding that Blob first and explicitly says to keep the app open.
- Native rendering also leaves its verified app-private file for this same publication path. FileProvider supports opening/sharing retained app copies.
- Save diagnostics include method, API level when available, requested/actual name, URI, written bytes, query result and exception. If the bridge fails before a native call, no API-level/query result is invented.

## Reproduced before production changes

[Test-only commit ce4c44c](https://github.com/yoonechauhan154-jpg/novacut/commit/ce4c44c67ca644cfc837911232aa775b012ee2ae), [Actions run #90](https://github.com/yoonechauhan154-jpg/novacut/actions/runs/41057336474): **5 failed, 30 passed (5.7m)**.

- 0.5x output was 10.029 seconds instead of 20.
- 2x output was 10.051 seconds instead of 5.
- Speed UI left timeline duration at 10 instead of 5.
- A mocked size mismatch returned saved=true.
- Five saves produced one distinct display name instead of five.

Null URI and thrown-error checks already passed at the bridge level; the new automatic-save UI tests additionally require a visible failure, retained bytes and working Save as.

## Validation and limits

The latest complete run, APK and exact test counts are recorded in the PR validation table. The first implementation run (#91) built the APK and passed all assertions, but one automatic-save test needed a retry. The follow-up uses live source readiness and waits for the decorated project to finish opening before its five exports.

New checks use a generated 10-second video with frame numbers and a changing tone. ffprobe checks 5-second and 20-second outputs, audio presence and aligned audio/video duration; ffmpeg checks changing frames and non-silent samples. Additional checks cover preview rate/time, split, undo/redo, reverse math/audio, keep-pitch, legacy timing, 10x WebCodecs frames, five automatic decorated saves, large multi-chunk output, null URI/exception/size mismatch/IS_PENDING failures, and direct document streaming when app storage fails. Android unit tests cover speed/pitch/effect parameters and 1,000 unique-name generations.

No existing assertions were removed, skipped or relaxed. The earlier Gallery mock was expanded to return exists/pending fields, matching the stricter native verifier. Workflow settings and dependencies remain unchanged.

Browser audio export tests use the recorder fallback when headless AAC encoding is unavailable. The separate 10x WebCodecs test validates H.264 video without audio. These are not proof of phone H.264+AAC, native device encoding, actual Gallery indexing or a document-provider permission flow. Sound quality at extreme rates and performance on large phone sources need listening/device tests. Retained app copies consume storage until explicitly discarded.

## Phone checklist

1. Install the latest green APK linked in PR 1 and confirm its Settings build ID.
2. Import a 10-second video with movement and sound. Preview/export at 2x: about 5 seconds. Reset, then 0.5x: about 20 seconds. Check the beginning and end, moving frames and sound timing.
3. Toggle keep-pitch, compare the sound, and test a speed change while playing. Scrub, open fullscreen, split a 2x clip, then undo/redo. Reopen an older project that already had a speed adjustment.
4. Try reverse plus speed through normal export. For the native speed test, use a simple clip without reverse/transitions/effect layers; unsupported edits should still be refused clearly.
5. Export a project with several effects five times. Each should show a verified Saved dialog and a different name. Check Gallery, Files > Movies/ClipNova, and Settings > My exports; use Open and Share.
6. Close/reopen the app and confirm My exports still opens the files. If a save fails, use Copy diagnostics and Save as to choose a folder. A failed public save should retain its app copy. If app storage is full, keep the app open until direct Save as succeeds or explicitly discard the finished output.
