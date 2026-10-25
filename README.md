# ClipNova — Offline Android Video Editor (Capacitor Project)

**App Name:** `ClipNova`  
**App ID (Package Name):** `com.clipnova.editor`  
**Mode:** 100% Offline Ready (Bundled Devanagari & Latin Fonts, Icons, Shaders, and Multi-Track Engine)

---

## Method 1: Easiest Way to Get the APK (No Coding / No Android Studio Needed!)

You can get the installable `.apk` file automatically using **GitHub Actions** in the cloud for free:

1. **Create a GitHub Account & Repository**
   - Go to [github.com](https://github.com) and sign in.
   - Click the **+** icon in the top-right corner and select **New repository**.
   - Name it `clipnova-android` and click **Create repository**.

2. **Upload This Project**
   - Download/export this project ZIP from AI Studio and unzip it on your computer or phone.
   - Upload all the files (making sure `.github/workflows/build-apk.yml` is included) to your new GitHub repository and commit them.

3. **Download Your Built APK**
   - Click the **Actions** tab at the top of your GitHub repository.
   - You will see a workflow running called **Build ClipNova Android APK**.
   - Wait about **2–3 minutes** for the green checkmark ✅.
   - Click on the completed workflow run, scroll down to the **Artifacts** section, and click **`ClipNova-Debug-APK`** to download a ZIP containing `app-debug.apk`.
   - Unzip it, copy `app-debug.apk` to your Android phone, tap it, and select **Install**!

---

## Method 2: Build the APK on Your Computer (Using Terminal / Android Studio)

### Prerequisites
- **Node.js 20+** installed ([nodejs.org](https://nodejs.org))
- **Java JDK 17** installed ([adoptium.net](https://adoptium.net))
- **Android Studio** (or Android SDK Command-line Tools) installed

### Step-by-Step Commands

Open a terminal inside the project folder and run:

```bash
# 1. Install all npm packages (including Capacitor and offline fonts)
npm install

# 2. Build the offline web application into the /dist folder
npm run build

# 3. Add Android platform (only needed if the /android folder doesn't exist yet)
npx cap add android

# 4. Sync the built web assets and Capacitor plugins into the Android project
npx cap sync android
```

### Option A: Build APK Directly from Terminal
```bash
cd android
./gradlew assembleDebug
```
Your APK will be ready at:
`android/app/build/outputs/apk/debug/app-debug.apk`

### Option B: Open in Android Studio & Run on Your Phone
```bash
npx cap open android
```
1. Wait for Android Studio to finish Gradle sync.
2. From the top menu, click **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
3. Click **Locate** in the notification popup to get `app-debug.apk`.

---

## What Was Configured for Android & Offline Use

1. **100% Offline Bundle (`src/main.tsx`, `index.html`, `vite.config.ts`)**:
   - Bundled `@fontsource/noto-sans-devanagari`, `@fontsource/outfit`, `@fontsource/plus-jakarta-sans`, `@fontsource/jetbrains-mono`, `@fontsource/rozha-one`, and `@fontsource/kalam` locally.
   - Removed all Google Fonts CDN links and external asset requests.
   - Configured `base: './'` in `vite.config.ts` so WebView `https://localhost` asset paths resolve offline.
2. **Android WebView Fixes (`src/utils/androidBridge.ts`)**:
   - **Gallery Import**: Native Android file picker support for Video (`video/*`), Photo (`image/*`), and Audio (`audio/*`).
   - **Voiceover Recording**: Requests `RECORD_AUDIO` permission and falls back gracefully across supported Android WebView `MediaRecorder` MIME types (`audio/webm;codecs=opus`, `audio/webm`, `audio/mp4`).
   - **File Export & Saving**: Uses `@capacitor/filesystem` and `@capacitor/share` so exported videos (`.webm`), FCPXML, SRT captions, and JSON project bundles are saved directly to Android storage and open the native Android Share sheet.
   - **Timeline Touch Gestures**: Added `touch-action: none`, pointer capture (`setPointerCapture`), and 2-finger pinch-to-zoom on the multi-track timeline so scrolling the Android WebView doesn't interrupt clip trimming or playhead scrubbing.
3. **Android Permissions (`android/app/src/main/AndroidManifest.xml`)**:
   - `android.permission.READ_MEDIA_VIDEO`
   - `android.permission.READ_MEDIA_IMAGES`
   - `android.permission.READ_MEDIA_AUDIO`
   - `android.permission.RECORD_AUDIO`
   - `android.permission.MODIFY_AUDIO_SETTINGS`
   - `android.permission.READ_EXTERNAL_STORAGE` (maxSdkVersion 32)
   - `android.permission.WRITE_EXTERNAL_STORAGE` (maxSdkVersion 29)
