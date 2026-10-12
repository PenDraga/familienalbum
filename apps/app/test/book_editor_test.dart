import 'dart:convert';
import 'dart:typed_data';

import 'package:familienalbum/features/books/book_edit.dart';
import 'package:familienalbum/features/books/book_editor_screen.dart';
import 'package:familienalbum/features/books/book_models.dart';
import 'package:familienalbum/features/books/books_repository.dart';
import 'package:familienalbum/l10n/l10n.dart';
import 'package:familienalbum/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> item(String id, {String? caption}) => {'mediaId': id, 'caption': caption, 'comments': <dynamic>[]};

List<BookPageJson> sample() => [
  {'type': 'cover', 'mediaId': 'a', 'title': 'Familie', 'subtitle': 'März 2026'},
  {'type': 'chapter', 'title': 'März 2026', 'subtitle': '4 Fotos'},
  {'type': 'photos', 'template': 'auto', 'items': [item('a', caption: 'Hallo'), item('b')]},
  {'type': 'photos', 'template': 'one', 'items': [item('c')]},
  {'type': 'photos', 'template': 'two', 'items': [item('d'), item('e')]},
];

// 1×1 PNG
final png = Uint8List.fromList(base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='));

void main() {
  group('Bearbeitungsschritte', () {
    test('Foto entfernen; leere Seite verschwindet; Eingabe bleibt unverändert', () {
      final pages = sample();
      final out = removeItem(pages, 3, 'c');
      expect(out, hasLength(4));
      expect(pages, hasLength(5));
      final out2 = removeItem(pages, 2, 'b');
      expect(pageMediaIds(out2[2]), ['a']);
    });

    test('Verschieben auf Nachbarseite, nicht über Kapitel hinweg; feste Vorlagen werden auto', () {
      final pages = sample();
      expect(moveItem(pages, 2, 'a', -1), isNull); // davor liegt das Kapitel
      final fwd = moveItem(pages, 3, 'c', 1)!;
      expect(fwd, hasLength(4)); // Seite mit c ist leer und verschwindet
      expect(pageMediaIds(fwd[3]), ['c', 'd', 'e']);
      expect(fwd[3]['template'], 'auto');
      final back = moveItem(pages, 2, 'b', 1)!;
      expect(pageMediaIds(back[3]), ['b', 'c']);
      expect(back[3]['template'], 'auto'); // «one» mit zwei Fotos geht nicht
    });

    test('Ausschnitt, Text ausblenden, Umschlagfoto und Titel', () {
      var pages = setCrop(sample(), 2, 'b', (x: 0.25, y: 0.123456, zoom: 1.5));
      expect(cropOf(pages[2], 'b'), (x: 0.25, y: 0.123, zoom: 1.5));
      expect(cropOf(pages[2], 'a'), isNull);
      pages = setCrop(pages, 2, 'b', null);
      expect(cropOf(pages[2], 'b'), isNull);
      pages = setCrop(pages, 0, 'a', (x: 0.5, y: 0.2, zoom: 1));
      expect(cropOf(pages[0], 'a')?.y, 0.2);
      pages = setCoverPhoto(pages, 'd');
      expect(pages[0]['mediaId'], 'd');
      expect(cropOf(pages[0], 'd'), isNull); // neues Foto, neuer Ausschnitt
      expect(pageHasText(pages[2]), isTrue);
      pages = setHideText(pages, 2, true);
      expect(pages[2]['hideText'], isTrue);
      pages = setText(pages, 1, 'title', 'Frühling');
      expect(pages[1]['title'], 'Frühling');
    });
  });

  testWidgets('Editor: blättern, Ausschnitt setzen, Foto entfernen, Speichern wird aktiv', (tester) async {
    tester.view.physicalSize = const Size(900, 2000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final views = [
      for (final (i, p) in sample().indexed)
        BookPageView(
          index: i,
          type: p['type'] as String,
          template: p['template'] as String?,
          title: p['title'] as String?,
          mediaCount: pageMediaIds(p).length,
          previewUrl: null,
          thumbs: [for (final _ in pageMediaIds(p)) ''],
          raw: p,
        ),
    ];
    final book = BookItem(
      id: 'b1',
      familyId: 'f1',
      createdByName: 'Admin',
      title: 'Familie',
      format: BookFormat.square21,
      textMode: BookTextMode.captions,
      months: const ['2026-03'],
      status: 'READY',
      pageCount: views.length,
      mediaCount: 5,
      canEdit: true,
      createdAt: DateTime.utc(2026, 10, 13),
      pages: views,
    );
    final previews = <Map<String, dynamic>>[];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          bookDetailProvider.overrideWith((ref, id) async => book),
          bookPagePreviewProvider.overrideWith((ref, args) async {
            previews.add(jsonDecode(args.json) as Map<String, dynamic>);
            return png;
          }),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          locale: const Locale('de', 'CH'),
          home: const BookEditorScreen(bookId: 'b1', initialPage: 2),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Seite 3 von 5'), findsWidgets);
    expect(previews.last['type'], 'photos');
    expect(find.text('Text auf dieser Seite zeigen'), findsOneWidget);
    // Speichern erst nach einer Änderung
    expect(tester.widget<TextButton>(find.widgetWithText(TextButton, 'Speichern')).onPressed, isNull);

    // Ausschnitt für Foto b: Tipp oben links im Foto
    await tester.tap(find.descendant(of: find.byKey(const ValueKey('book-photo-row-b')), matching: find.text('Ausschnitt')));
    await tester.pumpAndSettle();
    final area = tester.getRect(find.byKey(const ValueKey('book-crop-area')));
    await tester.tapAt(area.topLeft + Offset(area.width * 0.25, area.height * 0.2));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Fertig'));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    final itemB = (previews.last['items'] as List).cast<Map<String, dynamic>>().firstWhere((i) => i['mediaId'] == 'b');
    expect((itemB['crop'] as Map)['x'], closeTo(0.25, 0.01));
    expect((itemB['crop'] as Map)['y'], closeTo(0.2, 0.01));
    expect(tester.widget<TextButton>(find.widgetWithText(TextButton, 'Speichern')).onPressed, isNotNull);

    // Foto a entfernen
    await tester.tap(find.byKey(const ValueKey('book-remove-a')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('book-photo-row-a')), findsNothing);
    expect((previews.last['items'] as List), hasLength(1));

    // Zurückblättern zum Kapitel
    await tester.tap(find.byKey(const ValueKey('book-prev')));
    await tester.pumpAndSettle();
    expect(find.text('Seite 2 von 5'), findsWidgets);
    expect(find.text('Kapiteltitel'), findsOneWidget);

    // Umschlag: Titel, Untertitel, Foto wählen (Zeile ohne Layoutfehler im App-Theme)
    await tester.tap(find.byKey(const ValueKey('book-prev')));
    await tester.pumpAndSettle();
    expect(find.text('Seite 1 von 5'), findsWidgets);
    expect(find.text('Foto wählen'), findsOneWidget);
    expect(find.text('Untertitel'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Foto wählen'));
    await tester.pumpAndSettle();
    expect(find.byType(GridView), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
