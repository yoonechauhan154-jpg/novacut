package com.clipnova.editor;
import org.junit.Test;
import java.util.HashSet;
import static org.junit.Assert.*;
public class ExportNamesTest {
  @Test public void repeatedNamesNeverOverwriteEachOther() {
    HashSet<String> names = new HashSet<>();
    for (int i = 0; i < 1000; i++) {
      String name = ExportNames.unique("../same project.mp4");
      assertTrue(name.endsWith(".mp4")); assertFalse(name.contains("/")); assertTrue(names.add(name));
    }
  }
}
