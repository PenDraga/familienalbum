import 'package:familienalbum/features/auth/invite_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Einladungslink trägt Code und Server, Schema-Link öffnet /invite', () {
    final link = inviteLink('https://album.example.ch', 'ABC123');
    final uri = Uri.parse(link);
    expect(uri.host, 'album.example.ch');
    expect(uri.path, '/invite');
    expect(uri.queryParameters, {'code': 'ABC123', 'server': 'https://album.example.ch'});

    final app = Uri.parse(inviteAppLink('http://192.168.1.10:8080', 'XYZ'));
    expect(app.scheme, 'familienalbum');
    expect(app.path, '/invite');
    expect(app.queryParameters['server'], 'http://192.168.1.10:8080');
    expect(app.queryParameters['code'], 'XYZ');
  });
}
