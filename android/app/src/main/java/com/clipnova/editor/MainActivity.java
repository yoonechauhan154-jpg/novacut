package com.clipnova.editor;

import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.webkit.WebViewClient;
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
    registerPlugin(NativeExitReasonPlugin.class);
    super.onCreate(savedInstanceState);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    // Allow audio playback without requiring a user gesture on Android WebView
    getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);

    // --- Renderer crash visibility ---
    // If the WebView renderer process is killed (OOM, encoder crash, SIGKILL),
    // keep the app alive, reload the web view, and tell JS "renderer crashed"
    // so it can show the last export trace.
    WebView webView = getBridge().getWebView();
    final BridgeWebViewClient capClient = (BridgeWebViewClient) webView.getWebViewClient();
    webView.setWebViewClient(new WebViewClient() {
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

      public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
        if (capClient != null) {
          return capClient.shouldOverrideUrlLoading(view, request);
        }
        return super.shouldOverrideUrlLoading(view, request);
      }
    });
  }
}
