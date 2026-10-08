import 'package:dio/dio.dart';

import '../l10n/l10n.dart';

/// Fehler der API als RFC 7807 Problem-JSON (siehe docs/api.md).
class ApiException implements Exception {
  ApiException({required this.status, required this.code, required this.detail, this.title, this.extra = const {}});

  final int status;
  final String code;
  final String detail;
  final String? title;
  final Map<String, dynamic> extra;

  static ApiException fromDio(DioException e) {
    final res = e.response;
    final data = res?.data;
    final l10n = currentL10n();
    if (res != null && data is Map<String, dynamic> && data['status'] != null) {
      final known = {'type', 'title', 'status', 'detail', 'instance', 'code', 'errors'};
      return ApiException(
        status: res.statusCode ?? data['status'] as int,
        code: (data['code'] as String?) ?? 'HTTP_${res.statusCode}',
        detail: (data['detail'] as String?) ?? (data['title'] as String?) ?? l10n.errorUnknown,
        title: data['title'] as String?,
        extra: {for (final k in data.keys) if (!known.contains(k)) k: data[k]},
      );
    }
    if (res != null) {
      return ApiException(status: res.statusCode ?? 0, code: 'HTTP_${res.statusCode}', detail: l10n.errorServerStatus(res.statusCode ?? 0));
    }
    final msg = switch (e.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.receiveTimeout ||
      DioExceptionType.sendTimeout => l10n.errorTimeout,
      DioExceptionType.connectionError => l10n.errorNoConnection,
      _ => l10n.errorNetwork(e.message ?? e.type.name),
    };
    return ApiException(status: 0, code: 'NETWORK', detail: msg);
  }

  bool get isUnauthorized => status == 401;

  @override
  String toString() => detail;
}

/// Für UI: aus beliebigen Fehlern eine anzeigbare Meldung machen.
String errorMessage(Object error) {
  if (error is ApiException) return error.detail;
  if (error is DioException) return ApiException.fromDio(error).detail;
  return currentL10n().errorUnexpected('$error');
}
