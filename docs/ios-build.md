# iOS-Build auf dem Mac

Bundle-ID: `ch.familienalbum.familienalbum` · Anzeigename: Familienalbum · Minimum iOS 13 (Flutter-Standard).

## 1. Werkzeuge (einmalig, ca. 30–60 Minuten)

```bash
xcode-select --install
```

- **Xcode** aus dem App Store installieren, einmal starten und die iOS-Plattform mitinstallieren lassen
  (Xcode → Settings → Components → iOS).
- **Flutter** (stable):
  ```bash
  git clone --depth 1 -b stable https://github.com/flutter/flutter.git ~/flutter
  echo 'export PATH="$HOME/flutter/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
  flutter doctor
  ```
  `flutter doctor` muss bei Xcode grün sein. Fehlt CocoaPods: `sudo gem install cocoapods` oder `brew install cocoapods`.
- **Repo**:
  ```bash
  git clone https://github.com/PenDraga/familienalbum.git ~/familienalbum
  cd ~/familienalbum/apps/app && flutter pub get
  ```

## 2. Signierung in Xcode (einmalig)

```bash
cd ~/familienalbum/apps/app && open ios/Runner.xcworkspace
```

Wichtig: die **.xcworkspace** öffnen, nicht die .xcodeproj (CocoaPods).

1. Links „Runner“ auswählen → Target „Runner“ → Reiter **Signing & Capabilities**.
2. **Automatically manage signing** anhaken, dein **Team** wählen (Apple-Developer-Konto, in Xcode → Settings → Accounts hinterlegen).
3. Bundle Identifier bleibt `ch.familienalbum.familienalbum`. Xcode legt App-ID, Zertifikat und Profil selbst an.
4. Capabilities prüfen, die sollten schon da sein: **Background Modes** (Background fetch, Background processing, Remote notifications). Für Push später zusätzlich **Push Notifications** hinzufügen.
5. Xcode schliessen.

## 3. Auf dem eigenen iPhone starten

iPhone per Kabel anschliessen, entsperren, dem Mac vertrauen. Auf dem iPhone unter
Einstellungen → Datenschutz & Sicherheit → **Entwicklermodus** einschalten (Neustart).

```bash
cd ~/familienalbum/apps/app
flutter devices          # iPhone muss erscheinen
flutter run --release -d <iPhone-ID>
```

Beim ersten Start meldet iOS „Nicht vertrauenswürdiger Entwickler“: Einstellungen → Allgemein → VPN & Geräteverwaltung → Entwickler vertrauen.

Server-URL im Login-Screen eintragen (im WLAN z.B. `http://192.168.0.135:3000`, später die Cloudflare-Adresse).
Für HTTP im WLAN ist `NSAllowsLocalNetworking` bereits in der Info.plist gesetzt.

## 4. TestFlight für die Familie

```bash
cd ~/familienalbum/apps/app
flutter build ipa --release
```

Das erzeugt `build/ios/ipa/familienalbum.ipa` und ein Xcode-Archiv. Hochladen entweder

- mit der App **Transporter** (App Store): die .ipa hineinziehen, oder
- über Xcode: `open build/ios/archive/Runner.xcarchive` → Distribute App → App Store Connect → Upload.

Danach in [App Store Connect](https://appstoreconnect.apple.com) → App anlegen (Name Familienalbum, Bundle-ID wählen)
→ TestFlight → Build erscheint nach der Verarbeitung (10–30 Minuten) → **Interne Tester** (bis 100, sofort, kein Review)
oder **Externe Tester** (Familie per E-Mail-Link, einmaliges kurzes Beta-Review durch Apple).

Für jede neue Version: Build-Nummer erhöhen, sonst lehnt App Store Connect den Upload ab:

```bash
flutter build ipa --release --build-name=1.0.0 --build-number=2
```

## 5. Push (optional, später)

1. Firebase-Projekt anlegen, iOS-App mit der Bundle-ID hinzufügen.
2. Im Apple-Developer-Konto einen **APNs Auth Key** (.p8) erzeugen und in Firebase unter Cloud Messaging hochladen.
3. In Xcode die Capability **Push Notifications** hinzufügen.
4. App mit den vier Firebase-Werten bauen:
   ```bash
   flutter build ipa --release \
     --dart-define=FIREBASE_API_KEY=… --dart-define=FIREBASE_APP_ID=… \
     --dart-define=FIREBASE_PROJECT_ID=… --dart-define=FIREBASE_SENDER_ID=…
   ```
5. Server: Service-Account-JSON nach `infra/secrets/` und `FIREBASE_SERVICE_ACCOUNT` in der `.env` setzen.

## Was auf dem Gerät zu testen ist (bisher ungeprüft)

- Auto-Upload: Einstellungen → Automatischer Upload einschalten, Fotomediathek-Zugriff erlauben, ein Foto
  aufnehmen, App in den Hintergrund. Vordergrund-Sync beim Zurückkehren sollte sofort laufen; der Hintergrund-Job
  kommt, wann iOS will (oft erst nach Stunden, mit Ladekabel schneller).
- HEIC-Fotos aus der Mediathek: werden auf dem Gerät als JPEG geliefert oder serverseitig gewandelt.
- Hero-Übergang und Wischen zum Schliessen (nativ aktiv, im Web abgeschaltet).
- Push, sobald Firebase eingerichtet ist.

Wenn etwas hakt: `flutter run -d <iPhone-ID>` im Debug-Modus zeigt die Logs live im Terminal.
