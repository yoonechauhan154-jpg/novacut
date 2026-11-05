# Phase 1: export reliability and phone validation

This PR changes export decoding, encoding, verification and Android fallback. It does not implement phases 2–4. Do not describe a phone crash as fixed until the device checks below pass.

## What changed

- Export has its own 2×2 DOM video elements (opacity 0.01, muted, playsinline, preload auto) and canvas. Only active clips keep their decoders loaded. Split clips cannot race with the preview.
- Preview and audio playback stop before export. Forward frame capture uses requestVideoFrameCallback and playback; cuts, reverse jumps and overshoot use a bounded seek with listeners registered first.
- Failed seeks include clip ID, source type, DOM attachment, ready/network state, media error, buffered/seekable ranges, requested/actual time and dimensions. The export failure panel has a Copy diagnostics button.
- WebCodecs timestamps are microseconds; encoder queues are bounded; codec metadata reaches mp4-muxer. Audio source/PCM memory budgets fail clearly into native fallback instead of silently dropping sound.
- Settings Export Lab owns its canvas and media; an offline bundled fixture is available with no open project. T1/T2 no longer treat seek timeouts as success.
- Media3 1.9.0 is implemented and registered as NativeExporter. It decodes native staged files, trims and concatenates clips, applies constant speed, volume and fades, mixes imported audio, composites static bitmap overlays, emits progress and handles cancellation.
- Native input staging uses 256 KiB chunks across the bridge. Output is inspected before MediaStore publication; incomplete pending rows are removed.
- MP4 verification reads the actual sample tables and audio-track presence. All successful web exports decode six output samples and check duration. WebM audio is decoded, not inferred from file size. Native verification uses MediaExtractor and MediaMetadataRetriever. A rendered-frame count is labelled separately when the container sample count is unavailable.
- Native exports appear in My exports and can be opened/shared without copying a large file through JavaScript again.
- Recovery mode prefers native export after a previous process crash; it does not silently discard audio.

## Native compatibility, deliberately explicit

Supported initial native scope: consecutive imported main-track videos/images, cut/split/join, constant speed, volume, fades, imported audio clips, and static text/captions/stickers/image overlays. Default vignette is preserved with the same bitmap gradient. Adjacent identical vignettes share a bitmap.

The native fallback rejects gaps/overlapping main clips, animated/keyframed edits, dynamic effects/adjustment layers, transitions, video PIP, unsupported main transforms/filters/masks, synthetic audio, and animated/blended overlays. It does not silently flatten or omit them. These projects retain the WebView renderer; if that fails too, the dialog reports why there is no verified output.

Native gallery publishing currently requires Android 10 or later. Overlay bitmaps have a 32 MiB budget. The WebView audio path has source/PCM limits and a 180-second timeline limit; native export is used where compatible. The optional mp4box + VideoDecoder demux path was not added; this PR uses isolated element decoding plus Media3.

Six-frame motion sampling is evidence at sampled timestamps, not proof of every frame. An imported video that is intentionally visually static can be rejected as unverified. A WebView process kill cannot be caught by JavaScript in the same run; recovery prefers native on the next launch.

## Phone report follow-up: end-of-source frame capture

The first phone retest reached frame 400/414, then timed out requesting source time 13.633333 while the media element had reached its 13.798125-second end. This is evidence that end-of-source callback handling was incomplete; it is not a successful phone export.

The follow-up seeks directly near the source tail or when the decoder has passed the target, and handles an ended event or missing playback callback with one bounded seek to the requested time. It does not accept the last frame as a substitute for the requested frame. Cancellation and failed recovery seeks still abort. Native compatibility errors now list the exact blocking fields (for example transitionIn=fade or keyframes=1); the old generic message cannot identify which edit caused this report.

Retest the **same saved project, retaining all edits**, with normal MP4 at 1080p/30fps. Confirm it completes, the last second moves correctly, total duration is about 13.8 seconds, audio remains synchronized, and the saved file opens from My exports/Gallery. If it fails, copy the complete new diagnostics and Settings build ID. Test native baseline separately with an unanimated split/join project; do not remove edits from the failing project to hide this regression.

## Automated verification

The PR's GitHub Actions checks are authoritative for each commit; see the PR description for the exact final run and result.

- Existing Playwright tests retained, including split/play, pause/audio and fullscreen.
- Existing test assertion messages moved to Playwright's supported argument position; thresholds/assertions remain intact.
- Added seek-event ordering, decoder timeout diagnostics, split decoder isolation and cancellation cleanup checks.
- Added Settings-independent T1/T2 lab checks.
- Added simulated already-ended playback, an ended-event race, missing callbacks, cancellation and failed-seek recovery checks, plus an actual WebCodecs export of the final second of a source (30 decoded frames checked with ffprobe).
- Added a real split/join/speed export checked by ffprobe (duration, video frame count, audio stream) and ffmpeg (changing decoded frames and nonzero PCM audio).
- Added a direct WebCodecs MP4 sample-table check for timestamps and frame count. It skips only when headless Chromium reports no H.264 encoder, with the reason shown.
- Added native volume/fade endpoint unit tests; Android Java compilation and APK assembly include the plugin.
- No physical Android export has been run by this agent. Native codec execution, gallery visibility and share-sheet behavior require a phone.

## Phone acceptance checklist

1. Install the ClipNova-Debug-APK artifact from the final green PR run. Check Settings build ID matches that run's commit. Keep existing projects.
2. In airplane mode, open Settings → Export Lab before opening an editor. Run T1–T5. Confirm there is no missing-canvas message. Copy results if any test fails.
3. Create a project from a 10–20 second phone video with audible speech/movement. Export normally. Check start/middle/end movement, full duration and sound.
4. Split it twice, trim the pieces, reorder/join them, change one piece to 0.5× or 2× and another to 50% volume. Export normally and then with Use Android exporter. Compare cut positions and sound synchronization.
5. Add an imported audio track with an offset and fades. Check both clip audio and the added track in the saved video.
6. After the basic native cut/join test passes, add static English/Hindi text, a sticker and an image overlay. Test Use Android exporter and compare placement/visibility times with preview.
7. Try the original high-bitrate source that failed around 0.9 seconds. If WebView fails, confirm a compatible project falls back automatically to Android. Record build ID, Android/WebView versions and Copy diagnostics if it fails.
8. Check Movies/ClipNova in Gallery and My exports. Open and share the actual saved file. There must be no watermark.
9. Cancel an export, then export again. Confirm no ghost audio, stale success panel, extra partial gallery file or permanently busy UI.
10. Try a project with a video PIP/effect/keyframe using the native button. It should explain the unsupported edit rather than publish an incomplete video.
11. Recheck preview play/pause, playhead dragging, trim/split/undo/redo, fullscreen close, one open tool panel, safe areas and the Hindi/English switch.

Keep the PR unmerged if your phone still crashes or the native baseline fails. Report the failing checklist item and copied diagnostics before proceeding to Phase 2.
