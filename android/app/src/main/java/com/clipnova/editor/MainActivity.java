package com.clipnova.editor;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import android.webkit.WebSettings;
import com.clipnova.editor.MediaSaverPlugin;

public class MainActivity extends BridgeActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    registerPlugin(MediaSaverPlugin.class);
    super.onCreate(savedInstanceState);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    // Allow audio playback without requiring a user gesture on Android WebView
    getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
  }
}
