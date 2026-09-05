import 'dart:async';

import 'package:dio/dio.dart';

import 'api_exception.dart';
import 'token_store.dart';

/// Dio-Client mit Bearer-Token, automatischem Refresh (einmaliger Retry) und Problem-JSON-Fehlern.
class ApiClient {
  ApiClient({required this.baseUrl, required this.tokens, required this.onSessionExpired}) {
    dio = Dio(
      BaseOptions(
        baseUrl: '$baseUrl/api/v1',
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(minutes: 2),
        headers: {'accept': 'application/json'},
      ),
    );
    dio.interceptors.add(QueuedInterceptorsWrapper(onRequest: _onRequest, onError: _onError));
  }

  /// Origin des Servers ohne Pfad, z.B. https://album.example.ch
  final String baseUrl;
  final TokenStore tokens;
  final void Function() onSessionExpired;
  late final Dio dio;

  Future<TokenPair?>? _refreshing;

  /// Absolute URL für relative API-Pfade (signierte Medien-URLs).
  String absolute(String path) => path.startsWith('http') ? path : '$baseUrl$path';

  static bool _isAuthPath(String path) => path.startsWith('/auth/');

  Future<void> _onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    if (!_isAuthPath(options.path) && !options.headers.containsKey('authorization')) {
      final token = await tokens.accessToken();
      if (token != null) options.headers['authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  Future<void> _onError(DioException err, ErrorInterceptorHandler handler) async {
    final status = err.response?.statusCode;
    final options = err.requestOptions;
    final alreadyRetried = options.extra['retried'] == true;

    if (status == 401 && !_isAuthPath(options.path) && !alreadyRetried) {
      final refreshed = await _refreshTokens();
      if (refreshed != null) {
        options.headers['authorization'] = 'Bearer ${refreshed.accessToken}';
        options.extra['retried'] = true;
        try {
          final response = await dio.fetch<dynamic>(options);
          return handler.resolve(response);
        } on DioException catch (e) {
          return handler.reject(_wrap(e));
        }
      }
      onSessionExpired();
    }
    handler.reject(_wrap(err));
  }

  DioException _wrap(DioException e) => e.copyWith(error: ApiException.fromDio(e));

  /// Refresh mit Single-Flight: parallele 401er warten auf denselben Refresh.
  Future<TokenPair?> _refreshTokens() {
    return _refreshing ??= () async {
      try {
        final refreshToken = await tokens.refreshToken();
        if (refreshToken == null) return null;
        final bare = Dio(BaseOptions(baseUrl: dio.options.baseUrl, connectTimeout: const Duration(seconds: 15)));
        final res = await bare.post<Map<String, dynamic>>('/auth/refresh', data: {'refreshToken': refreshToken});
        final pair = TokenPair.fromJson(res.data!['tokens'] as Map<String, dynamic>);
        await tokens.save(pair);
        return pair;
      } on DioException {
        await tokens.clear();
        return null;
      } finally {
        _refreshing = null;
      }
    }();
  }

  void dispose() => dio.close(force: true);
}

/// Wandelt Dio-Fehler beim Aufrufen in ApiException um.
extension ApiCall<T> on Future<Response<T>> {
  Future<T> unwrap() async {
    try {
      return (await this).data as T;
    } on DioException catch (e) {
      throw (e.error is ApiException) ? e.error! as ApiException : ApiException.fromDio(e);
    }
  }
}
