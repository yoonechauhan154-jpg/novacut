package com.clipnova.editor;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;

/**
 * Reads Android's historical process exit reasons (API 30+).
 * Returns reason (CRASH_NATIVE, LOW_MEMORY, SIGNALED, etc.), description,
 * and RSS/PSS memory pages so the WebView can show why the previous export
 * process was killed.
 */
public class NativeExitReasonPlugin extends Plugin {

  @PluginMethod
  public void getHistoricalProcessExitReasons(PluginCall call) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      JSObject ret = new JSObject();
      ret.put("supported", false);
      ret.put("reason", null);
      ret.put("description", "API 30+ required for process exit reasons");
      call.resolve(ret);
      return;
    }

    ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
    if (am == null) {
      call.reject("ActivityManager not available");
      return;
    }

    try {
      // Get up to 10 recent exit reasons for our own process
      java.util.List<ActivityManager.HistoricalProcessExitReason> reasons =
          am.getHistoricalProcessExitReasons(
              android.os.Process.myPid(),
              ActivityManager.REASON_CRASH_NATIVE |
              ActivityManager.REASON_LOW_MEMORY |
              ActivityManager.REASON_SIGNALED |
              ActivityManager.REASON_SERVICE |
              ActivityManager.REASON_ANR,
              10);

      JSArray arr = new JSArray();
      ActivityManager.HistoricalProcessExitReason latest = null;

      for (ActivityManager.HistoricalProcessExitReason r : reasons) {
        JSObject entry = new JSObject();
        entry.put("reason", exitReasonToString(r.getReason()));
        entry.put("description", r.getDescription());
        entry.put("timestampMs", r.getTimestamp());
        entry.put("rssPages", r.getRssPages());
        entry.put("pssPages", r.getPssPages());
        arr.put(entry);
        latest = r;
      }

      JSObject ret = new JSObject();
      ret.put("supported", true);
      ret.put("count", reasons.size());
      ret.put("reasons", arr);
      if (latest != null) {
        ret.put("lastReason", exitReasonToString(latest.getReason()));
        ret.put("lastDescription", latest.getDescription());
        ret.put("lastRssPages", latest.getRssPages());
        ret.put("lastPssPages", latest.getPssPages());
      }
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("Failed to read exit reasons: " + e.getMessage());
    }
  }

  private static String exitReasonToString(int reason) {
    switch (reason) {
      case ActivityManager.REASON_CRASH_NATIVE: return "CRASH_NATIVE";
      case ActivityManager.REASON_LOW_MEMORY: return "LOW_MEMORY";
      case ActivityManager.REASON_SIGNALED: return "SIGNALED";
      case ActivityManager.REASON_SERVICE: return "SERVICE";
      case ActivityManager.REASON_ANR: return "ANR";
      case ActivityManager.REASON_CRASH: return "CRASH";
      case ActivityManager.REASON_LOW_MEMORY_PROCESS: return "LOW_MEMORY_PROCESS";
      default: return "UNKNOWN_" + reason;
    }
  }
}
