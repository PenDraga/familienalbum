import 'package:familienalbum/features/settings/storage_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('formatBytes rundet auf Deutsch', () {
    expect(formatBytes(0), '0 B');
    expect(formatBytes(830 * 1000 * 1000), '830 MB');
    expect(formatBytes(12400 * 1000 * 1000), '12,4 GB');
    expect(formatBytes(1500), '1,50 KB');
    expect(formatBytes(4 * 1000 * 1000 * 1000 * 1000), '4,00 TB');
  });

  Future<void> pump(WidgetTester tester, FamilyStorage storage) async {
    await tester.pumpWidget(
      ProviderScope(
        key: UniqueKey(), // neuer Container pro Aufruf, Overrides gelten sonst nur beim ersten Mal
        overrides: [familyStorageProvider.overrideWith((ref, familyId) async => storage)],
        child: const MaterialApp(home: Scaffold(body: StorageCard(familyId: 'f1'))),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('zeigt Verbrauch und für Admins den freien Platz', (tester) async {
    await pump(tester, const FamilyStorage(totalBytes: 12400000000, photoBytes: 2400000000, videoBytes: 10000000000, photoCount: 1200, videoCount: 48, disk: DiskSpace(totalBytes: 4000000000000, freeBytes: 1200000000000)));
    expect(find.text('Euer Album belegt 12,4 GB'), findsOneWidget);
    expect(find.text('1200 Fotos · 48 Videos'), findsOneWidget);
    expect(find.text('Fotos 2,40 GB'), findsOneWidget);
    expect(find.text('Videos 10,0 GB'), findsOneWidget);
    expect(find.text('Server: 1,20 TB frei von 4,00 TB'), findsOneWidget);
    expect(find.text('70 % belegt'), findsOneWidget);
    expect(find.textContaining('Speicher wird knapp'), findsNothing);
  });

  testWidgets('ohne disk keine Server-Zeile; fast voll warnt', (tester) async {
    await pump(tester, const FamilyStorage(totalBytes: 0, photoBytes: 0, videoBytes: 0, photoCount: 0, videoCount: 0));
    expect(find.text('Euer Album belegt 0 B'), findsOneWidget);
    expect(find.text('0 Fotos · 0 Videos'), findsOneWidget);
    expect(find.textContaining('Server:'), findsNothing);

    await pump(tester, const FamilyStorage(totalBytes: 1, photoBytes: 1, videoBytes: 0, photoCount: 1, videoCount: 0, disk: DiskSpace(totalBytes: 1000, freeBytes: 50)));
    expect(find.text('95 % belegt'), findsOneWidget);
    expect(find.textContaining('Speicher wird knapp'), findsOneWidget);
  });
}
