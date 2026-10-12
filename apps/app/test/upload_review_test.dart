import 'dart:convert';
import 'dart:typed_data';

import 'package:familienalbum/features/books/book_models.dart';
import 'package:familienalbum/features/books/book_screen.dart';
import 'package:familienalbum/features/books/books_repository.dart';
import 'package:familienalbum/features/upload/upload_review_screen.dart';
import 'package:familienalbum/l10n/l10n.dart';
import 'package:familienalbum/theme/app_theme.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';

/// PlatformFile ist abstrakt (file_picker 12); für den Test reicht Name und Grösse.
base class _File extends PlatformFile {
  _File(this.name, this.bytes) : uri = Uri.file('/tmp/$name');
  @override
  final String name;
  @override
  final Uri uri;
  final Uint8List bytes;
  @override
  get xFile => throw UnimplementedError();
  @override
  int? lengthSync() => bytes.length;
  @override
  Future<int> length() async => bytes.length;
  @override
  Future<Uint8List> readAsBytes() async => bytes;
  @override
  Stream<Uint8List> readAsByteStream() => Stream.value(bytes);
}

final png = Uint8List.fromList(base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='));

Widget app(Widget home, {List<dynamic> overrides = const []}) => ProviderScope(
  key: UniqueKey(),
  overrides: [...overrides.cast()],
  child: MaterialApp(
    theme: AppTheme.light(),
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    locale: const Locale('de', 'CH'),
    home: home,
  ),
);

void main() {
  setUpAll(() => initializeDateFormatting('de_CH'));

  testWidgets('Upload-Assistent: Beschreibung pro Foto, «für alle» füllt nur leere Felder, Abbrechen liefert null', (tester) async {
    final files = [
      _File('see.jpg', png),
      _File('gipfel.jpg', png),
      _File('film.mp4', Uint8List(10)),
    ];
    Map<int, String>? result = {};
    await tester.pumpWidget(
      app(
        Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: FilledButton(
                onPressed: () async {
                  result = await Navigator.of(context).push<Map<int, String>>(
                    MaterialPageRoute(builder: (_) => UploadReviewScreen(files: files, bytes: [Future.value(png), Future.value(png), null])),
                  );
                },
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('3 Dateien hochladen'), findsOneWidget);
    expect(find.text('gipfel.jpg'), findsOneWidget);
    expect(find.byIcon(Icons.videocam_outlined), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('upload-caption-1')), 'Gipfel erreicht ⛰️');
    await tester.enterText(find.byKey(const ValueKey('upload-caption-all')), 'Ferien im Tessin');
    await tester.tap(find.text('Übernehmen'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('upload-start')));
    await tester.pumpAndSettle();
    expect(result, {0: 'Ferien im Tessin', 1: 'Gipfel erreicht ⛰️', 2: 'Ferien im Tessin'});

    // Mit offener Tastatur (halber Bildschirm) bleibt «Hochladen» sichtbar; «Fertig» schliesst die Tastatur
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('upload-caption-0')));
    tester.view.viewInsets = const FakeViewPadding(bottom: 1200);
    addTearDown(tester.view.resetViewInsets);
    await tester.pumpAndSettle();
    final button = tester.getRect(find.byKey(const ValueKey('upload-start')));
    expect(button.bottom, lessThanOrEqualTo(tester.view.physicalSize.height / tester.view.devicePixelRatio - 1200 / tester.view.devicePixelRatio + 1));
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(FocusManager.instance.primaryFocus?.context?.widget is EditableText, isFalse);
    tester.view.resetViewInsets();
    await tester.tap(find.byKey(const ValueKey('upload-start-top')));
    await tester.pumpAndSettle();
    expect(result, isEmpty);

    // Abbrechen: nichts hochladen
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Abbrechen'));
    await tester.pumpAndSettle();
    expect(result, isNull);
  });

  testWidgets('Fotobuch-Entwurf: Hinweis und «PDF erstellen»; während des Renderns kein Knopf', (tester) async {
    BookItem book(String status, {DateTime? renderedAt}) => BookItem(
      id: 'b1',
      familyId: 'f1',
      createdByName: 'Admin',
      title: 'Familie',
      format: BookFormat.square21,
      textMode: BookTextMode.captions,
      months: const ['2026-03'],
      status: status,
      pageCount: 3,
      mediaCount: 2,
      canEdit: true,
      createdAt: DateTime.utc(2026, 10, 13),
      renderedAt: renderedAt,
    );
    Future<void> pump(BookItem b) async {
      await tester.pumpWidget(app(const BookScreen(bookId: 'b1'), overrides: [bookDetailProvider.overrideWith((ref, id) async => b)]));
      // Beim Rendern dreht eine Ladeanzeige endlos – darum feste Zeit statt pumpAndSettle
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump(const Duration(milliseconds: 300));
    }

    await pump(book('DRAFT'));
    expect(find.text('Entwurf'), findsWidgets);
    expect(find.text('Prüfe die Seiten und erstelle dann das PDF zum Bestellen.'), findsOneWidget);
    expect(find.byKey(const ValueKey('book-create-pdf')), findsOneWidget);
    expect(find.byIcon(Icons.download_outlined), findsNothing);

    await pump(book('DRAFT', renderedAt: DateTime.utc(2026, 10, 12)));
    expect(find.textContaining('Seit dem letzten PDF geändert'), findsOneWidget);

    await pump(book('RENDERING'));
    expect(find.text('Das PDF wird gerade erstellt …'), findsOneWidget);
    expect(find.byKey(const ValueKey('book-create-pdf')), findsNothing);

    await pump(book('READY'));
    expect(find.byKey(const ValueKey('book-status')), findsNothing);
    expect(BookItem.fromJson({
      'id': 'b', 'familyId': 'f', 'title': 't', 'format': 'SQUARE_21', 'textMode': 'NONE', 'months': <String>[], 'status': 'DRAFT',
      'pageCount': 1, 'mediaCount': 1, 'createdAt': '2026-10-13T00:00:00.000Z', 'renderedAt': null,
      'urls': {'pdf': null, 'cover': null, 'coverPhoto': '/t'},
    }, (p) => 'https://x$p').coverPhotoUrl, 'https://x/t');
  });
}
