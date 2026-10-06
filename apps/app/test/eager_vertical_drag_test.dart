import 'package:familienalbum/features/media/eager_vertical_drag.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Nachbau der Gesten-Schichtung im Foto-Viewer:
/// Swipe-Recognizer → GestureDetector(onTap) → PageView → GestureDetector(onDoubleTap) → InteractiveViewer
Widget viewer({required Type type, required GestureRecognizerFactory factory, required TransformationController controller}) => MaterialApp(
  home: RawGestureDetector(
    gestures: {type: factory},
    child: GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () {},
      child: PageView.builder(
        itemCount: 3,
        itemBuilder: (_, i) => GestureDetector(
          onDoubleTapDown: (_) {},
          onDoubleTap: () {},
          child: InteractiveViewer(
            transformationController: i == 0 ? controller : TransformationController(),
            panEnabled: false,
            minScale: 1,
            maxScale: 5,
            clipBehavior: Clip.none,
            child: const SizedBox.expand(child: ColoredBox(color: Colors.grey)),
          ),
        ),
      ),
    ),
  ),
);

Future<void> pinch(WidgetTester tester) async {
  final a = await tester.startGesture(const Offset(200, 380));
  final b = await tester.startGesture(const Offset(200, 420));
  for (var i = 0; i < 12; i++) {
    await a.moveBy(const Offset(-4, -12));
    await b.moveBy(const Offset(4, 12));
    await tester.pump(const Duration(milliseconds: 16));
  }
  await a.up();
  await b.up();
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('ein Finger nach unten: Wischen gewinnt gegen PageView und Zoom-Viewer', (tester) async {
    final controller = TransformationController();
    var dy = 0.0;
    await tester.pumpWidget(viewer(type: EagerVerticalDragRecognizer, factory: GestureRecognizerFactoryWithHandlers<EagerVerticalDragRecognizer>(EagerVerticalDragRecognizer.new, (r) => r..onUpdate = (d) => dy += d.delta.dy), controller: controller));
    final g = await tester.startGesture(const Offset(200, 300));
    for (var i = 0; i < 10; i++) {
      await g.moveBy(const Offset(0, 20));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await g.up();
    await tester.pumpAndSettle();
    expect(dy, greaterThan(100));
    expect(controller.value.getMaxScaleOnAxis(), closeTo(1, 0.01));
  });

  testWidgets('zwei Finger: Pinch zoomt, das Wischen gibt auf', (tester) async {
    final controller = TransformationController();
    var dy = 0.0;
    await tester.pumpWidget(viewer(type: EagerVerticalDragRecognizer, factory: GestureRecognizerFactoryWithHandlers<EagerVerticalDragRecognizer>(EagerVerticalDragRecognizer.new, (r) => r..onUpdate = (d) => dy += d.delta.dy), controller: controller));
    await pinch(tester);
    expect(controller.value.getMaxScaleOnAxis(), greaterThan(1.5));
    expect(dy, 0);
  });
}
