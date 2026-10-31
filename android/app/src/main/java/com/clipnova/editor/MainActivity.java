package com.clipnova.editor;

import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import android.webkit.WebSettings;
import com.clipnova.editor.MediaSaverPlugin;
import com.clipnova.editor.NativeExitReasonPlugin;

public class MainActivity extends BridgeActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    registerPlugin(MediaSaverPlugin.class);
    registerPlugin(NativeExporterPlugin.class);
    registerPlugin(NativeExitReasonPlugin.class);
    super.onCreate(savedInstanceState);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    // Allow audio playback without requiring a user gesture on Android WebView
    getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);

    // --- Renderer crash visibility ---
    // Subclass BridgeWebViewClient (NOT plain WebViewClient) so Capacitor's
    // shouldInterceptRequest still serves https://localhost/ from app assets.
    // Only onRenderProcessGone is overridden; everything else delegates to super.
    WebView webView = getBridge().getWebView();
    webView.setWebViewClient(new BridgeWebViewClient(getBridge()) {
      public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        super.onRenderProcessGone(view, detail);
        String reason = "unknown";
        if (detail != null) {
          reason = detail.toString();
        }
        // Tell JS the renderer crashed so it can show the trace dialog.
        try {
          getBridge().getWebView().loadUrl(
              "javascript:(function(){window.dispatchEvent(new CustomEvent('clipnova-renderer-crashed',{detail:{reason:'" + reason + "'}}));})()");
        } catch (Exception ignored) {}
        // Reload to recover
        try {
          webView.postDelayed(() -> webView.reload(), 1000);
        } catch (Exception ignored) {}
        return true;
      }
    });
  }
}
