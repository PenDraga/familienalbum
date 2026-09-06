import { accessSync, constants, readFileSync } from 'node:fs';
import { cert, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';

export interface PushMessage {
  title: string;
  body: string;
  /** Nur Strings (FCM-Vorgabe) */
  data: Record<string, string>;
}

export interface PushResult {
  sent: number;
  /** Tokens, die FCM als ungültig meldet – werden vom Aufrufer gelöscht */
  invalidTokens: string[];
}

export interface PushSender {
  readonly enabled: boolean;
  send(tokens: string[], message: PushMessage): Promise<PushResult>;
}

/** Ohne Firebase-Konfiguration: nichts senden, Clients pollen. */
export class NoopPushSender implements PushSender {
  readonly enabled = false;
  async send(): Promise<PushResult> {
    return { sent: 0, invalidTokens: [] };
  }
}

/** Für Tests: zeichnet Sendungen auf, meldet vorgemerkte Tokens als ungültig. */
export class RecordingPushSender implements PushSender {
  readonly enabled = true;
  readonly sent: Array<{ tokens: string[]; message: PushMessage }> = [];
  readonly invalid = new Set<string>();

  async send(tokens: string[], message: PushMessage): Promise<PushResult> {
    this.sent.push({ tokens: [...tokens], message });
    const invalidTokens = tokens.filter((t) => this.invalid.has(t));
    return { sent: tokens.length - invalidTokens.length, invalidTokens };
  }

  reset() {
    this.sent.length = 0;
    this.invalid.clear();
  }
}

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/** Firebase Cloud Messaging über firebase-admin (Service-Account-JSON). */
export class FcmPushSender implements PushSender {
  readonly enabled = true;
  private readonly messaging: Messaging;

  constructor(serviceAccountPath: string, app?: App) {
    const firebase = app ?? initializeApp({ credential: cert(serviceAccountPath) }, 'familienalbum');
    this.messaging = getMessaging(firebase);
  }

  async send(tokens: string[], message: PushMessage): Promise<PushResult> {
    const result: PushResult = { sent: 0, invalidTokens: [] };
    // FCM erlaubt max. 500 Tokens pro Multicast
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const res = await this.messaging.sendEachForMulticast({
        tokens: batch,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: 'high', notification: { channelId: 'familienalbum', sound: 'default' } },
        apns: { payload: { aps: { sound: 'default', badge: 1 } } },
      });
      result.sent += res.successCount;
      res.responses.forEach((r, idx) => {
        if (!r.success && r.error && INVALID_TOKEN_CODES.has(r.error.code)) result.invalidTokens.push(batch[idx]!);
      });
    }
    return result;
  }
}

/**
 * Push-Sender aus der Konfiguration bauen. Ein fehlender oder kaputter Dienstkonto-Schlüssel darf den
 * Server nicht in eine Neustart-Schleife schicken: dann Push aus, Clients pollen, Grund im Log.
 */
export function createPushSender(
  serviceAccountPath: string | undefined,
  log: { error: (o: object, msg: string) => void },
): PushSender {
  if (!serviceAccountPath) return new NoopPushSender();
  try {
    accessSync(serviceAccountPath, constants.R_OK);
    const parsed = JSON.parse(readFileSync(serviceAccountPath, 'utf8')) as Record<string, unknown>;
    for (const key of ['project_id', 'client_email', 'private_key']) {
      if (typeof parsed[key] !== 'string') throw new Error(`Feld "${key}" fehlt – ist das die Dienstkonto-JSON aus Firebase?`);
    }
    return new FcmPushSender(serviceAccountPath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const reason =
      e.code === 'ENOENT'
        ? 'Datei nicht gefunden (Pfad aus Sicht des Containers, z.B. /run/secrets/…; ist ./secrets eingehängt?)'
        : e.code === 'EACCES'
          ? 'keine Leserechte (Container läuft als Benutzer "node")'
          : e.message;
    log.error({ path: serviceAccountPath, reason }, 'FIREBASE_SERVICE_ACCOUNT unbrauchbar – Push bleibt aus, Clients pollen');
    return new NoopPushSender();
  }
}
