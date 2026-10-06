import 'package:flutter/gestures.dart';

/// Vertikaler Drag für «Wischen nach unten schliesst», der sich von InteractiveViewer und PageView
/// nicht aus der Gesten-Arena drängen lässt – aber nur mit einem Finger. Sobald ein zweiter Finger
/// aufsetzt (Pinch-Zoom), gibt er auf, damit der Zoom-Recognizer beide Finger bekommt.
class EagerVerticalDragRecognizer extends VerticalDragGestureRecognizer {
  EagerVerticalDragRecognizer({super.debugOwner});

  int _fingers = 0;
  int? _tracked;

  @override
  void addAllowedPointer(PointerDownEvent event) {
    _fingers++;
    if (_fingers > 1) {
      // Pinch: eigenen Anspruch aufgeben; war der erste Finger schon angenommen, Drag abbrechen
      if (_tracked != null) stopTrackingPointer(_tracked!);
      resolve(GestureDisposition.rejected);
      return;
    }
    _tracked = event.pointer;
    super.addAllowedPointer(event);
  }

  @override
  void didStopTrackingLastPointer(int pointer) {
    _fingers = 0;
    _tracked = null;
    super.didStopTrackingLastPointer(pointer);
  }

  @override
  void rejectGesture(int pointer) {
    // Ein Finger: Ablehnung ignorieren (sonst gewinnt der Zoom-Viewer jedes vertikale Wischen).
    // Mehrere Finger: Ablehnung akzeptieren, der Pinch gehört dem InteractiveViewer.
    if (_fingers <= 1) {
      acceptGesture(pointer);
    } else {
      super.rejectGesture(pointer);
    }
  }
}
