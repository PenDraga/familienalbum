import Flutter
import UIKit
import workmanager_apple
import FirebaseMessaging

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Auto-Upload im Hintergrund (BGTaskScheduler); Identifier muss zu Info.plist passen
    WorkmanagerPlugin.registerPeriodicTask(withIdentifier: "ch.familienalbum.autoupload", frequency: NSNumber(value: 30 * 60))
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }

  // APNs-Registrierung sichtbar machen (Push-Diagnose); super reicht den Token an die Flutter-Plugins weiter
  override func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    NSLog("APNs: Geräte-Token erhalten (%d Bytes)", deviceToken.count)
    super.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)
    // Das Plugin meldet den Token je nach Build als Sandbox (Debug) oder Produktion (Release). Per Kabel
    // installierte Release-Builds haben aber ein Entwicklungs-Profil → Sandbox-Token. `.unknown` lässt
    // FCM die Umgebung aus dem Provisioning-Profil lesen, damit Kabel-Builds und TestFlight beide gehen.
    Messaging.messaging().setAPNSToken(deviceToken, type: .unknown)
  }

  override func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    NSLog("APNs: Registrierung fehlgeschlagen: %@", error.localizedDescription)
    super.application(application, didFailToRegisterForRemoteNotificationsWithError: error)
  }
}
