package com.clipnova.editor;
import java.util.UUID;
final class ExportNames {
  static String unique(String requested) {
    String safe = requested.replaceAll("[^a-zA-Z0-9._-]", "_");
    int dot = safe.lastIndexOf('.');
    String stem = dot > 0 ? safe.substring(0, dot) : safe;
    String ext = dot > 0 ? safe.substring(dot) : ".mp4";
    if (stem.length() > 80) stem = stem.substring(0, 80);
    return stem + "-" + System.currentTimeMillis() + "-" + UUID.randomUUID().toString().substring(0, 8) + ext;
  }
}
