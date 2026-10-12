import 'package:familienalbum/features/admin/rights_editor.dart';
import 'package:familienalbum/features/auth/auth_models.dart';
import 'package:familienalbum/features/books/book_models.dart';
import 'package:familienalbum/features/books/books_repository.dart';
import 'package:familienalbum/features/books/create_book_dialog.dart';
import 'package:familienalbum/l10n/l10n.dart';
import 'package:familienalbum/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';

Widget app(Widget home) => ProviderScope(
  key: UniqueKey(),
  child: MaterialApp(
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    locale: const Locale('de', 'CH'),
    home: home,
  ),
);

void main() {
  setUpAll(() => initializeDateFormatting('de_CH'));

  test('BookItem liest Liste und Detail (Seiten, Vorschau, Thumbnails) aus dem JSON', () {
    final json = {
      'id': 'b1',
      'familyId': 'f1',
      'createdBy': {'id': 'u1', 'displayName': 'Tante', 'avatarUrl': null},
      'title': 'Frühling',
      'format': 'A4_LANDSCAPE',
      'textMode': 'COMMENTS',
      'months': ['2026-03', '2026-04'],
      'onlyCommented': false,
      'status': 'READY',
      'error': null,
      'pageCount': 3,
      'mediaCount': 2,
      'pdfBytes': 123456,
      'createdAt': '2026-10-12T10:00:00.000Z',
      'updatedAt': '2026-10-12T10:00:00.000Z',
      'renderedAt': '2026-10-12T10:05:00.000Z',
      'canEdit': true,
      'urls': {'pdf': '/api/v1/books/b1/pdf?exp=1&sig=x', 'cover': '/api/v1/books/b1/pages/1?exp=1&sig=y'},
      'pages': [
        {'index': 0, 'page': {'type': 'cover', 'mediaId': 'm1', 'title': 'Frühling', 'subtitle': 'März – April 2026'}, 'previewUrl': '/p/1', 'thumbs': ['/t/m1']},
        {'index': 1, 'page': {'type': 'chapter', 'title': 'März 2026', 'subtitle': '2 Fotos'}, 'previewUrl': '/p/2', 'thumbs': []},
        {
          'index': 2,
          'page': {
            'type': 'photos',
            'template': 'two',
            'items': [
              {'mediaId': 'm1', 'caption': null, 'comments': []},
              {'mediaId': 'm2', 'caption': null, 'comments': []},
            ],
          },
          'previewUrl': '/p/3',
          'thumbs': ['/t/m1', '/t/m2'],
        },
      ],
    };
    final book = BookItem.fromJson(json, (p) => 'https://album.test$p');
    expect(book.format, BookFormat.a4Landscape);
    expect(book.textMode, BookTextMode.comments);
    expect(book.isReady, isTrue);
    expect(book.pdfUrl, 'https://album.test/api/v1/books/b1/pdf?exp=1&sig=x');
    expect(book.coverUrl, startsWith('https://album.test/api/v1/books/b1/pages/1'));
    expect(book.pages, hasLength(3));
    expect(book.pages[0].mediaCount, 1);
    expect(book.pages[1].type, 'chapter');
    expect(book.pages[2].template, 'two');
    expect(book.pages[2].thumbs, ['https://album.test/t/m1', 'https://album.test/t/m2']);

    // Liste ohne Seiten; fehlendes canCreateBooks in alten Antworten → false
    final list = BookItem.fromJson({...json, 'pages': null, 'status': 'PROCESSING', 'urls': {'pdf': null, 'cover': null}}, (p) => p);
    expect(list.pages, isEmpty);
    expect(list.isReady, isFalse);
    expect(MembershipFlags.fromJson({'isFamilyAdmin': false, 'canUpload': true, 'canDownload': false, 'canComment': true}).canCreateBooks, isFalse);
  });

  testWidgets('Rechte-Editor hat den Schalter «Darf Fotobücher erstellen»', (tester) async {
    MembershipFlags? changed;
    await tester.pumpWidget(
      app(
        Scaffold(
          body: RightsEditor(
            value: const MembershipFlags(isFamilyAdmin: false, canUpload: true, canDownload: false, canComment: true),
            onChanged: (v) => changed = v,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Darf Fotobücher erstellen'), findsOneWidget);
    await tester.tap(find.text('Darf Fotobücher erstellen'));
    await tester.pumpAndSettle();
    expect(changed?.canCreateBooks, isTrue);
    expect(changed?.canUpload, isTrue);
    expect(flagsToJson(changed!)['canCreateBooks'], isTrue);
  });

  testWidgets('Assistent: nur Jahre und Monate mit Fotos, Fotos abwählen, Anordnung mit Seitenschätzung', (tester) async {
    tester.view.physicalSize = const Size(900, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final photos = [
      for (var i = 0; i < 5; i++)
        BookPhoto(id: 'p$i', takenAt: DateTime.utc(2026, i < 3 ? 4 : 3, 1 + i), commentCount: i == 1 ? 2 : 0, thumbUrl: ''),
    ];
    BookPreviewArgs? lastArgs;
    await tester.pumpWidget(
      ProviderScope(
        key: UniqueKey(),
        overrides: [
          bookMonthsProvider.overrideWith((ref, familyId) async => const [
            BookMonth(month: '2026-04', count: 3),
            BookMonth(month: '2026-03', count: 2),
            BookMonth(month: '2025-12', count: 1),
          ]),
          bookPhotosProvider.overrideWith((ref, key) async => photos),
          bookPreviewProvider.overrideWith((ref, args) async {
            lastArgs = args;
            final n = 5 - args.request.excludeMediaIds.length;
            return BookPreview(pageCount: args.request.layout == BookLayout.single ? n + 3 : 4, mediaCount: n, maxPages: 200);
          }),
        ],
        child: MaterialApp(
          // App-Theme: gefüllte Knöpfe sind dort volle Breite (deckte einen Layoutfehler auf)
          theme: AppTheme.light(),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          locale: const Locale('de', 'CH'),
          home: const BookWizardScreen(familyId: 'f1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Schritt 1: nur 2026 und 2025, im neusten Jahr nur April und März (beide vorgewählt)
    expect(find.widgetWithText(ChoiceChip, '2026'), findsOneWidget);
    expect(find.widgetWithText(ChoiceChip, '2025'), findsOneWidget);
    expect(find.byType(ChoiceChip), findsNWidgets(2));
    expect(find.byType(FilterChip), findsNWidgets(2));
    expect(find.text('März · 2'), findsOneWidget);
    expect(find.text('April · 3'), findsOneWidget);
    expect(find.text('5 Fotos'), findsOneWidget);

    await tester.tap(find.widgetWithText(ChoiceChip, '2025'));
    await tester.pumpAndSettle();
    expect(find.text('Dezember · 1'), findsOneWidget);
    expect(find.byType(FilterChip), findsOneWidget);
    await tester.tap(find.widgetWithText(ChoiceChip, '2026'));
    await tester.pumpAndSettle();

    // Schritt 2: Fotos abwählen
    await tester.tap(find.text('Weiter'));
    await tester.pumpAndSettle();
    expect(find.text('5 von 5 Fotos im Buch'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('book-photo-p0')));
    await tester.pumpAndSettle();
    expect(find.text('4 von 5 Fotos im Buch'), findsOneWidget);
    await tester.tap(find.text('Nur kommentierte'));
    await tester.pumpAndSettle();
    expect(find.text('1 von 5 Fotos im Buch'), findsOneWidget);
    await tester.tap(find.text('Alle'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('book-photo-p4')));
    await tester.pumpAndSettle();

    // Schritt 3: Anordnung wählen, Schätzung folgt
    await tester.tap(find.text('Weiter'));
    await tester.pumpAndSettle();
    expect(find.text('Gemischt'), findsOneWidget);
    expect(find.text('Ca. 4 Seiten · 4 Fotos'), findsOneWidget);
    expect(lastArgs?.request.excludeMediaIds, ['p4']);
    expect(lastArgs?.request.months, ['2026-03', '2026-04']);
    await tester.tap(find.text('Ein Foto pro Seite'));
    await tester.pumpAndSettle();
    expect(find.text('Ca. 7 Seiten · 4 Fotos'), findsOneWidget);
    expect(lastArgs?.request.toJson()['layout'], 'SINGLE');
  });
}
