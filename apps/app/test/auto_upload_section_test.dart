import 'package:familienalbum/core/providers.dart';
import 'package:familienalbum/features/auth/auth_controller.dart';
import 'package:familienalbum/features/auth/auth_models.dart';
import 'package:familienalbum/features/autoupload/auto_upload_section.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';

Me me({required bool canUpload}) => Me(
  id: 'u1',
  email: 'oma@example.com',
  displayName: 'Oma',
  isAdmin: false,
  families: [Family(id: 'f1', name: 'Familie Muster', membership: MembershipFlags(isFamilyAdmin: false, canUpload: canUpload, canDownload: false, canComment: true))],
);

Future<void> pump(WidgetTester tester, Me user) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  await tester.pumpWidget(
    ProviderScope(
      key: UniqueKey(),
      overrides: [sharedPreferencesProvider.overrideWithValue(prefs), meProvider.overrideWithValue(user)],
      child: const MaterialApp(home: Scaffold(body: AutoUploadSection())),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() => initializeDateFormatting('de_CH'));

  testWidgets('ohne Upload-Recht ist der Schalter gesperrt und erklärt warum', (tester) async {
    await pump(tester, me(canUpload: false));
    final tile = tester.widget<SwitchListTile>(find.byType(SwitchListTile).first);
    expect(tile.onChanged, isNull);
    expect(tile.value, isFalse);
    expect(find.textContaining('Recht «Hochladen»'), findsOneWidget);
  });

  testWidgets('mit Upload-Recht lässt sich der Schalter bedienen', (tester) async {
    await pump(tester, me(canUpload: true));
    final tile = tester.widget<SwitchListTile>(find.byType(SwitchListTile).first);
    expect(tile.onChanged, isNotNull);
    expect(find.textContaining('ohne dass du daran denken musst'), findsOneWidget);
  });
}
