import 'package:familienalbum/features/admin/rights_editor.dart';
import 'package:familienalbum/features/auth/auth_models.dart';
import 'package:familienalbum/features/books/book_models.dart';
import 'package:familienalbum/features/books/create_book_dialog.dart';
import 'package:familienalbum/l10n/l10n.dart';
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

  testWidgets('Dialog «Fotobuch erstellen» zeigt Monate, Formate und Textmodus', (tester) async {
    await tester.pumpWidget(
      app(
        Scaffold(
          body: Consumer(
            builder: (context, ref, _) => Center(
              child: FilledButton(onPressed: () => showCreateBookDialog(context, ref, 'f1'), child: const Text('open')),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('Fotobuch erstellen'), findsOneWidget);
    expect(find.byType(FilterChip), findsNWidgets(12));
    expect(find.byType(ChoiceChip), findsNWidgets(6));
    expect(find.text('21 × 21 cm'), findsOneWidget);
    expect(find.text('A4 quer'), findsOneWidget);
    expect(find.text('Bildunterschriften'), findsOneWidget);
    expect(find.text('Mit Kommentaren'), findsOneWidget);
    expect(find.text('Nur kommentierte Fotos'), findsOneWidget);

    // Alle Monate abwählen → «Erstellen» gesperrt
    for (var i = 0; i < 12; i++) {
      if (tester.widget<FilterChip>(find.byType(FilterChip).at(i)).selected) {
        await tester.tap(find.byType(FilterChip).at(i));
        await tester.pump();
      }
    }
    await tester.pumpAndSettle();
    final create = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Erstellen'));
    expect(create.onPressed, isNull);
  });
}
