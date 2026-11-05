# Source lifetime investigation (Phase 1)

The corrected phone report is authoritative: each imported source exports once, then subsequent attempts fail with `Failed to fetch`, including after app restart. The native rejection for slide / Light Leak is correct. The earlier EOF report is not the diagnosis of this corrected report.

## What is proved

Before changing production code, commit `d8e74b5c46bfe5192576bd40a8124bae5a5cb769` added regression tests. [Actions run #83](https://github.com/yoonechauhan154-jpg/novacut/actions/runs/40951590392) reported **3 failed, 20 passed (3.5m)**. Both ordinary and transition/effect projects exported three times in one browser session, but failed after page reload and opening from Home. A third test deliberately invalidated the old URL and reproduced the same error. The failing stack is `decodeSourceAudio → fetch(src)`.

This proves the stale-source-handle defect and the failure after reopening. It does **not** reproduce the phone's exact second-export invalidation within the same session. A transient Android picker/provider-backed File is a plausible contributor; the existing logs cannot prove why that particular handle became unreadable. New preflight and ownership diagnostics must confirm the remaining device-specific part.

## Hypothesis audit (links pinned to the failing implementation)

| Hypothesis | Evidence and conclusion |
| --- | --- |
| 1. Export/save deletes or revokes the imported source | No such call found in the audited paths. [androidBridge.ts:249](https://github.com/yoonechauhan154-jpg/novacut/blob/d06fb8e41b51a7b3516ae0befe1167179bc3c24e/src/utils/androidBridge.ts#L249) creates `clipnova-exports/<name>`; [315](https://github.com/yoonechauhan154-jpg/novacut/blob/d06fb8e41b51a7b3516ae0befe1167179bc3c24e/src/utils/androidBridge.ts#L315) and [342](https://github.com/yoonechauhan154-jpg/novacut/blob/d06fb8e41b51a7b3516ae0befe1167179bc3c24e/src/utils/androidBridge.ts#L342) delete that cache path. [MediaSaverPlugin.java:101](https://github.com/yoonechauhan154-jpg/novacut/blob/d06fb8e41b51a7b3516ae0befe1167179bc3c24e/android/app/src/main/java/com/clipnova/editor/MediaSaverPlugin.java#L101) copies the input; it does not delete it (its old comment was inaccurate). [App.tsx:2180](https://github.com/yoonechauhan154-jpg/novacut/blob/d06fb8e41b51a7b3516ae0befe1167179bc3c24e/src/App.tsx#L2180) revokes the previous export result URL, while [verifyOutput.ts:53](https://github.com/yoonechauhan154-jpg/novacut/blob/d06fb8e41b51a7b3516ae0befe1167179bc3c24e/src/export/verifyOutput.ts#L53) creates and later revokes its own verification URL. Export cache names were not unique; this is hardened, but not evidence that they deleted a source. |
| 2. Stale serialized URLs used despite saved bytes | **Confirmed defect.** [mediaImporter.ts:44](https://github.com/yoonechauhan154-jpg/novacut/blob/d06fb8e41b51a7b3516ae0befe1167179bc3c24e/src/utils/mediaImporter.ts#L44) makes a URL from the picker File and saves it on the media item/clip. [App.tsx:1167](https://github.com/yoonechauhan154-jpg/novacut/blob/d06fb8e41b51a7b3516ae0befe1167179bc3c24e/src/App.tsx#L1167) opens the saved project unchanged. [App.tsx:587](https://github.com/yoonechauhan154-jpg/novacut/blob/d06fb8e41b51a7b3516ae0befe1167179bc3c24e/src/App.tsx#L587) restores the Blob only into a private preview variable; it does not repair `clip.mediaUrl`. Export does not resolve `mediaBlobId`, and [exportEngine.ts:207](https://github.com/yoonechauhan154-jpg/novacut/blob/d06fb8e41b51a7b3516ae0befe1167179bc3c24e/src/export/exportEngine.ts#L207) fetches the stale URL. Preview can therefore look valid while export fails. |
| 3. In-memory or cache-only original | Import did attempt IDB persistence, so this was not strictly URL-only storage. However [projectStorage.ts:46](https://github.com/yoonechauhan154-jpg/novacut/blob/d06fb8e41b51a7b3516ae0befe1167179bc3c24e/src/utils/projectStorage.ts#L46) put the original File directly and [52](https://github.com/yoonechauhan154-jpg/novacut/blob/d06fb8e41b51a7b3516ae0befe1167179bc3c24e/src/utils/projectStorage.ts#L52) silently swallowed quota/write errors. Import still reported success with no verified durable copy. There was no independent Android Data copy. A thumbnail proves nothing about the source bytes. |
| 4. Split half disposes shared source | [App.tsx:1590](https://github.com/yoonechauhan154-jpg/novacut/blob/d06fb8e41b51a7b3516ae0befe1167179bc3c24e/src/App.tsx#L1590) spreads the clip, retaining the same `mediaBlobId`/URL; only source timing changes. Export elements are distinct and their disposal clears element src, without revoking the project URL. No split-specific source deletion found. New ownership tests cover two concurrent leases and both split halves. |
| 5. Crash Ladder marks source unusable | [exportEngine.ts:785](https://github.com/yoonechauhan154-jpg/novacut/blob/d06fb8e41b51a7b3516ae0befe1167179bc3c24e/src/export/exportEngine.ts#L785) stores strategy results, but the active export coordinator does not read this ladder state to blacklist a source. Crash recovery may prefer native for the entire next attempt; there is no per-source exported-once flag. No evidence of this causing `fetch` failure. Separately, recovery formerly treated any last non-finish breadcrumb as a crash; this is now tracked by explicit export lifecycle state, so source diagnostics cannot accidentally select native-first recovery. |

## Implementation

- Readable legacy raw File/Blob records are migrated on project open; exports themselves remain read-only toward source storage.
- Import materializes bytes before reporting success. Browsers store a Blob made from byte chunks in IndexedDB. Android writes a size-checked copy to app-private `Directory.Data/clipnova-sources`, not Cache; IDB records the path, original name, size and MIME type. Storage failures are visible.
- Opening a project resolves every source ID and probes it, including audio and media-library entries. Missing media is identified immediately with an English/Hindi Relink button. Relinking one shared source updates all its split references while retaining timing, transitions and effects.
- Every export obtains a separate source lease. Browser URLs are recreated from stored bytes; Android URLs and native file URIs refer to the durable copy. Export is read-only toward stored sources.
- Source checks log original/resolved schemes, fetch/read availability, size, file stat/path when applicable, and matching recorded revocation/deletion events. They appear in the failure dialog and Export Playback Log; Copy includes the persistent ownership audit.
- URL cleanup checks the creating owner. Export temp-file cleanup rejects source directories. Gallery output uses a unique cache name; MediaSaver accepts only export-owned cache files and does not delete its input.
- Native Media3 can read the app-owned Data source directly. Only staged overlay/legacy temporary inputs and the temporary output are cleaned by export.
- Project deletion removes durable media only when no other saved project references the ID. Splits and duplicate projects share source bytes safely.

## Tests and limitations

Final CI and artifact links are in PR 1. Existing tests remain enabled. Added coverage includes:

- Import a real video; export three times; save the third result through the Gallery function with mocked Filesystem/MediaSaver; export again.
- Reload the page, open the saved project from Home, export, split in the editor UI, and export again.
- Repeat that sequence with a slide transition and Light Leak effect layer.
- Verify each produced file with ffprobe (duration, video frames, audio stream) and ffmpeg (changing frame hashes and nonzero decoded PCM).
- Invalidate an old object URL deliberately; export from the durable record.
- Check that export/save cleanup leaves active source URLs fetchable; disposing one lease does not dispose split handles in another.
- Missing-source UI/relink, legacy-record migration and shared-source retention across project deletion. Relink suspends preview work and shows busy state; its test waits for the durable copy and checks that both split clips retain their edits.
- Source diagnostics after a completed export must not change crash-recovery state; an interrupted export stays marked running even after the log ring buffer fills.

Gallery is mocked in browser tests. Android Data storage/provider behavior, actual Gallery publication, and the precise second-export failure require the phone. Clearing app data or uninstalling removes app-private media; this change cannot recover bytes that were never successfully stored. Relink is provided for those projects.

## Phone retest

1. Install the latest green PR 1 APK and note Settings build ID.
2. First reopen the already failing project. If its saved bytes exist, export it without removing the transition/effect. If Source missing appears, use Relink with the original file; keep the existing edits.
3. Import a new video with audible speech and motion. Export it **three times in a row**, saving each to Gallery. Verify full duration, changing frames and sound in each saved output.
4. Completely close the app, reopen the project from Home, and export again.
5. Split the source, add a slide transition and Light Leak effect layer, then repeat three exports and a full app close/reopen/export.
6. Use normal export for the decorated project. Native rejection of unsupported effects remains correct; do not remove edits to conceal a source-lifetime failure.
7. If any step fails, send Copy diagnostics from the failure dialog or Export Playback Log, plus build ID and the failing step. The source-check and ownership entries are needed.

PR 1 stays unmerged until phone acceptance. Phase 2 has not started.
