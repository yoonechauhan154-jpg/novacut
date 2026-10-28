package com.clipnova.editor;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;

import java.lang.reflect.Method;
import java.util.List;

/**
 * Reads Android's historical process exit reasons (API 30+).
 * Uses reflection so the code compiles even if the build SDK doesn't
 * expose ActivityManager.HistoricalProcessExitReason or REASON_* constants.
 * Returns reason, status, description, importance, RSS/PSS pages so the
 * WebView can show why the previous export process was killed.
 */
public class NativeExitReasonPlugin extends Plugin {

  // Reason code values (matching ActivityManager.REASON_* constants)
  private static final int REASON_CRASH_NATIVE = 1;
  private static final int REASON_LOW_MEMORY = 2;
  private static final int REASON_SIGNALED = 4;
  private static final int REASON_SERVICE = 8;
  private static final int REASON_ANR = 16;

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
      // Prefer the packageName-based overload:
      // getHistoricalProcessExitReasons(String packageName, int reasons, int max)
      Method getByPackage =
          ActivityManager.class.getMethod(
              "getHistoricalProcessExitReasons", String.class, int.class, int.class);
      @SuppressWarnings("unchecked")
      List<Object> reasons =
          (List<Object>)
              getByPackage.invoke(
                  am,
                  getContext().getPackageName(),
                  REASON_CRASH_NATIVE | REASON_LOW_MEMORY | REASON_SIGNALED | REASON_SERVICE | REASON_ANR,
                  5);

      JSArray arr = new JSArray();
      Object latest = null;

      Class<?> reasonCls = Class.forName("android.app.ActivityManager$HistoricalProcessExitReason");
      Method getReason = reasonCls.getMethod("getReason");
      Method getStatus = reasonCls.getMethod("getStatus");
      Method getDescription = reasonCls.getMethod("getDescription");
      Method getTimestamp = reasonCls.getMethod("getTimestamp");
      Method getImportance = reasonCls.getMethod("getImportance");
      Method getRssPages = reasonCls.getMethod("getRssPages");
      Method getPssPages = reasonCls.getMethod("getPssPages");

      for (Object r : reasons) {
        JSObject entry = new JSObject();
        int reasonCode = (Integer) getReason.invoke(r);
        entry.put("reason", exitReasonToString(reasonCode));
        entry.put("status", (Integer) getStatus.invoke(r));
        entry.put("description", (String) getDescription.invoke(r));
        entry.put("timestampMs", (Long) getTimestamp.invoke(r));
        entry.put("importance", (Integer) getImportance.invoke(r));
        entry.put("rssPages", (Integer) getRssPages.invoke(r));
        entry.put("pssPages", (Integer) getPssPages.invoke(r));
        arr.put(entry);
        latest = r;
      }

      JSObject ret = new JSObject();
      ret.put("supported", true);
      ret.put("count", reasons.size());
      ret.put("reasons", arr);
      if (latest != null) {
        int reasonCode = (Integer) getReason.invoke(latest);
        ret.put("lastReason", exitReasonToString(reasonCode));
        ret.put("lastStatus", (Integer) getStatus.invoke(latest));
        ret.put("lastDescription", (String) getDescription.invoke(latest));
        ret.put("lastTimestampMs", (Long) getTimestamp.invoke(latest));
        ret.put("lastImportance", (Integer) getImportance.invoke(latest));
        ret.put("lastRssPages", (Integer) getRssPages.invoke(latest));
        ret.put("lastPssPages", (Integer) getPssPages.invoke(latest));
      }
      call.resolve(ret);
    } catch (NoSuchMethodException e) {
      // Fall back to PID-based overload if packageName overload doesn't exist on this SDK
      try {
        Method getByPid =
            ActivityManager.class.getMethod(
                "getHistoricalProcessExitReasons", int.class, int.class, int.class);
        @SuppressWarnings("unchecked")
        List<Object> reasons =
            (List<Object>)
                getByPid.invoke(
                    am,
                    android.os.Process.myPid(),
                    REASON_CRASH_NATIVE | REASON_LOW_MEMORY | REASON_SIGNALED | REASON_SERVICE | REASON_ANR,
                    5);

        JSArray arr = new JSArray();
        Object latest = null;
        Class<?> reasonCls = Class.forName("android.app.ActivityManager$HistoricalProcessExitReason");
        Method getReason = reasonCls.getMethod("getReason");
        Method getStatus = reasonCls.getMethod("getStatus");
        Method getDescription = reasonCls.getMethod("getDescription");
        Method getTimestamp = reasonCls.getMethod("getTimestamp");
        Method getImportance = reasonCls.getMethod("getImportance");
        Method getRssPages = reasonCls.getMethod("getRssPages");
        Method getPssPages = reasonCls.getMethod("getPssPages");

        for (Object r : reasons) {
          JSObject entry = new JSObject();
          int reasonCode = (Integer) getReason.invoke(r);
          entry.put("reason", exitReasonToString(reasonCode));
          entry.put("status", (Integer) getStatus.invoke(r));
          entry.put("description", (String) getDescription.invoke(r));
          entry.put("timestampMs", (Long) getTimestamp.invoke(r));
          entry.put("importance", (Integer) getImportance.invoke(r));
          entry.put("rssPages", (Integer) getRssPages.invoke(r));
          entry.put("pssPages", (Integer) getPssPages.invoke(r));
          arr.put(entry);
          latest = r;
        }

        JSObject ret = new JSObject();
        ret.put("supported", true);
        ret.put("count", reasons.size());
        ret.put("reasons", arr);
        if (latest != null) {
          int reasonCode = (Integer) getReason.invoke(latest);
          ret.put("lastReason", exitReasonToString(reasonCode));
          ret.put("lastStatus", (Integer) getStatus.invoke(latest));
          ret.put("lastDescription", (String) getDescription.invoke(latest));
          ret.put("lastTimestampMs", (Long) getTimestamp.invoke(latest));
          ret.put("lastImportance", (Integer) getImportance.invoke(latest));
          ret.put("lastRssPages", (Integer) getRssPages.invoke(latest));
          ret.put("lastPssPages", (Integer) getPssPages.invoke(latest));
        }
        call.resolve(ret);
      } catch (Exception e2) {
        call.reject("Failed to read exit reasons: " + e2.getMessage());
      }
    } catch (Exception e) {
      call.reject("Failed to read exit reasons: " + e.getMessage());
    }
  }

  private static String exitReasonToString(int reason) {
    switch (reason) {
      case REASON_CRASH_NATIVE: return "CRASH_NATIVE";
      case REASON_LOW_MEMORY: return "LOW_MEMORY";
      case REASON_SIGNALED: return "SIGNALED";
      case REASON_SERVICE: return "SERVICE";
      case REASON_ANR: return "ANR";
      default: return "UNKNOWN_" + reason;
    }
  }
}
