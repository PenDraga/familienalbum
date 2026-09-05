# ADR-0002: Handgeschriebener API-Client in der Flutter-App (statt openapi-generator)

Status: **vorgeschlagen – Rücksprache offen** · Datum: 2026-09-04

## Kontext

CLAUDE.md sieht vor, den Flutter-Client per `openapi-generator` (dart-dio) aus der OpenAPI-Spezifikation
zu erzeugen. Für M3 wurde stattdessen ein schlanker, handgeschriebener Client gebaut
(`apps/app/lib/core/api_client.dart` plus Modelle in den Features).

Gründe:

- Der dart-dio-Generator benötigt zusätzlich `built_value`, `built_collection` und einen `build_runner`-Schritt;
  das erzeugt für aktuell ~25 Endpunkte mehrere tausend Zeilen generierten Code und macht Builds langsamer.
- Der Generator braucht Java in CI und lokal; die generierten Modelle passen schlecht zu Riverpod-Zuständen
  (immutable `built_value`-Klassen mit Buildern).
- Signierte Medien-URLs, Chunk-Uploads mit Streams und Token-Refresh brauchen ohnehin handgeschriebene
  Dio-Interceptoren.

## Entscheidung (vorläufig)

- Die OpenAPI-Spezifikation bleibt die Referenz (`docs/openapi.json`, `npm run openapi -w apps/api`).
- Die App enthält handgeschriebene Modelle mit `fromJson`, ein `ApiClient` mit Auth-Interceptor
  und pro Feature ein kleines Repository. Fehler werden als `ApiException` (Problem-JSON) gemappt.
- Wächst die API deutlich (M4–M7), wird der Generator erneut evaluiert – dann eher `openapi_generator`
  mit `dart` (json_serializable) statt `dart-dio`/`built_value`.

## Konsequenzen

- Schema-Änderungen im Backend müssen in den Dart-Modellen nachgezogen werden. Die Backend-Tests
  sichern das API-Format; ein Vertragstest für die Dart-Modelle ist noch offen.
- Kein Java und kein Codegen-Schritt im Flutter-Build.
