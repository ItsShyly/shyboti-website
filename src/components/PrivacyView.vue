<script setup lang="ts">
import { useI18n } from "../i18n";
const { locale } = useI18n();
</script>

<template>
  <div class="privacy">
    <div class="privacy-inner">
      <!-- vvv german vvv -->
      <template v-if="locale === 'de'">
        <h1 class="privacy-title">Datenschutzerklärung</h1>
        <p class="privacy-meta">Zuletzt aktualisiert: März 2026 · shyboti.de</p>
        <div class="notice">
          ShyBoti und shyboti.de sind unabhängige Projekte und stehen in keiner
          Verbindung zu
          <strong>Twitch Interactive, Inc.</strong> und werden von dieser weder
          unterstützt noch gesponsert. Twitch ist eine eingetragene Marke von
          Twitch Interactive, Inc.
        </div>
        <section>
          <h2>1. Wer wir sind</h2>
          <p>
            ShyBoti (<strong>shyboti.de</strong>) ist ein privates
            Twitch-Bot-Dashboard-Projekt. Es bietet Broadcastern und ihren
            Moderatoren Werkzeuge zur Verwaltung von Chat-Commands,
            Automationen, Moderationsregeln und Chat-Logs für Twitch-Kanäle.
          </p>
        </section>
        <section>
          <h2>2. Welche Daten wir erheben</h2>
          <h3>2.1 Twitch OAuth-Daten</h3>
          <p>Wenn du dich über Twitch anmeldest, erhalten und speichern wir:</p>
          <ul>
            <li>Deinen Twitch-Benutzernamen und Anzeigenamen</li>
            <li>Deine Twitch-Benutzer-ID</li>
            <li>OAuth-Zugriffs- und Refresh-Tokens</li>
          </ul>
          <p>
            Wir erhalten oder speichern weder deine E-Mail-Adresse noch
            Zahlungsinformationen oder dein Passwort.
          </p>
          <h3>2.2 Chat-Logs</h3>
          <p>
            Die Logs-Funktion leitet öffentlich verfügbaren Chatverlauf von
            <strong>Spanix</strong> (logs.spanix.team) weiter. Wir speichern
            diese Daten nicht selbst. Nutzer können dem Anzeigen ihrer
            Nachrichten über die Settings widersprechen.
          </p>
          <h3>2.3 Konfigurationsdaten</h3>
          <p>
            Wir speichern Commands, Timer, Trigger, Moderationsregeln, Rollen-
            und Berechtigungseinstellungen sowie Channel-Feature-Flags.
          </p>
          <h3>2.4 Aktivitätsprotokolle</h3>
          <p>
            Wir führen pro Kanal ein Aktivitätsprotokoll, das nur für den
            Broadcaster und autorisierte Moderatoren sichtbar ist.
          </p>
          <h3>2.5 Sitzungsdaten</h3>
          <p>
            Ein Sitzungstoken wird im <code>localStorage</code> gespeichert und
            beim Abmelden ungültig gemacht.
          </p>
        </section>
        <section>
          <h2>3. Wie wir deine Daten verwenden</h2>
          <ul>
            <li>Authentifizierung über Twitch</li>
            <li>Betrieb des Bots auf deinem Kanal</li>
            <li>Anzeige der Kanalkonfiguration im Dashboard</li>
            <li>Synchronisierung von Einstellungen zwischen Kanälen</li>
          </ul>
          <p>
            <strong
              >Wir verkaufen, teilen oder verwenden deine Daten nicht für
              Werbezwecke.</strong
            >
          </p>
        </section>
        <section>
          <h2>4. Datenweitergabe</h2>
          <p>
            Wir teilen Daten nur für den technischen Betrieb:
            <strong>Twitch API</strong> (Authentifizierung),
            <strong>Spanix</strong> (Chat-Logs), <strong>7TV</strong> (Emotes).
          </p>
        </section>
        <section>
          <h2>5. Datenspeicherung</h2>
          <p>
            Konfigurationsdaten werden gespeichert, solange dein Kanal ShyBoti
            verwendet. Auf Anfrage löschen wir alle gespeicherten Daten.
          </p>
        </section>
        <section>
          <h2>6. Deine Rechte</h2>
          <ul>
            <li>Zugriff auf gespeicherte Daten</li>
            <li>Berichtigung oder Löschung</li>
            <li>Log-Opt-out direkt im Dashboard</li>
            <li>
              Twitch-OAuth widerrufen via
              <a
                href="https://www.twitch.tv/settings/connections"
                target="_blank"
                rel="noopener"
                >Twitch-Verbindungseinstellungen</a
              >
            </li>
          </ul>
          <p>Kontakt: <strong>contact@shyboti.de</strong>.</p>
        </section>
        <section>
          <h2>7. Cookies &amp; Local Storage</h2>
          <p>
            Nur <code>localStorage</code> für das Sitzungstoken. Keine
            Tracking-Cookies oder Analysetools.
          </p>
        </section>
        <section>
          <h2>8. Sicherheit</h2>
          <p>
            OAuth-Tokens serverseitig gespeichert, nur für autorisierte
            API-Anfragen. HTTPS für alle Verbindungen.
          </p>
        </section>
        <section>
          <h2>9. Dienste von Drittanbietern</h2>
          <ul>
            <li>
              <strong>Twitch Interactive, Inc.</strong> -
              <a
                href="https://www.twitch.tv/p/legal/privacy-policy/"
                target="_blank"
                rel="noopener"
                >twitch.tv/p/legal/privacy-policy</a
              >
            </li>
            <li><strong>Spanix</strong> - logs.spanix.team</li>
            <li><strong>7TV</strong> - 7tv.app</li>
          </ul>
          <p>
            ShyBoti steht in <strong>keiner Verbindung</strong> zu den genannten
            Diensten.
          </p>
        </section>
        <section>
          <h2>10. Änderungen</h2>
          <p>
            Wir können diese Datenschutzerklärung aktualisieren. Das Datum oben
            zeigt die letzte Änderung.
          </p>
        </section>
        <section>
          <h2>11. Kontakt</h2>
          <p>Fragen? Kontaktiere mich: <strong>contact@shyboti.de</strong>.</p>
        </section>
      </template>
      <!-- ^^^ german ^^^ -->

      <!-- vvv english vvv -->
      <template v-else>
        <h1 class="privacy-title">Privacy Policy</h1>
        <p class="privacy-meta">Last updated: March 2026 · shyboti.de</p>
        <div class="notice">
          ShyBoti and shyboti.de are independent projects and are
          <strong
            >not affiliated with, endorsed by, or sponsored by Twitch
            Interactive, Inc.</strong
          >
          Twitch is a trademark of Twitch Interactive, Inc.
        </div>
        <section>
          <h2>1. Who We Are</h2>
          <p>
            ShyBoti (<strong>shyboti.de</strong>) is a personal Twitch bot
            dashboard project providing broadcasters and moderators with tools
            to manage chat commands, automations, moderation rules, and chat
            logs.
          </p>
        </section>
        <section>
          <h2>2. What Data We Collect</h2>
          <h3>2.1 Twitch OAuth Data</h3>
          <p>When you log in via Twitch, we receive and store:</p>
          <ul>
            <li>Your Twitch username and display name</li>
            <li>Your Twitch user ID</li>
            <li>OAuth access and refresh tokens</li>
          </ul>
          <p>
            We do not receive or store your email address, payment information,
            or password.
          </p>
          <h3>2.2 Chat Logs</h3>
          <p>
            The Logs feature proxies publicly available chat history from
            <strong>Spanix</strong> (logs.spanix.team). We do not store this
            data ourselves. Users may opt out via the Settings page.
          </p>
          <h3>2.3 Configuration Data</h3>
          <p>
            We store commands, timers, triggers, moderation rules, role and
            permission settings, and channel feature flags.
          </p>
          <h3>2.4 Activity Logs</h3>
          <p>
            A per-channel activity log of dashboard actions, visible only to the
            broadcaster and authorised moderators.
          </p>
          <h3>2.5 Session Data</h3>
          <p>
            A session token is stored in <code>localStorage</code> and
            invalidated on logout.
          </p>
        </section>
        <section>
          <h2>3. How We Use Your Data</h2>
          <ul>
            <li>Authenticate you via Twitch</li>
            <li>Operate the bot on your channel</li>
            <li>Display your channel configuration in the dashboard</li>
            <li>Sync settings between channels</li>
          </ul>
          <p>
            <strong
              >We do not sell, share, or use your data for advertising.</strong
            >
          </p>
        </section>
        <section>
          <h2>4. Data Sharing</h2>
          <p>
            We share data only for technical operation:
            <strong>Twitch API</strong> (authentication),
            <strong>Spanix</strong> (chat logs), <strong>7TV</strong> (emotes).
          </p>
        </section>
        <section>
          <h2>5. Data Retention</h2>
          <p>
            Configuration data is kept as long as your channel uses ShyBoti. You
            may request deletion at any time by contacting us.
          </p>
        </section>
        <section>
          <h2>6. Your Rights</h2>
          <ul>
            <li>Access your stored data</li>
            <li>Request correction or deletion</li>
            <li>Opt out of log display in the dashboard Settings</li>
            <li>
              Revoke Twitch OAuth via
              <a
                href="https://www.twitch.tv/settings/connections"
                target="_blank"
                rel="noopener"
                >Twitch connections settings</a
              >
            </li>
          </ul>
          <p>Contact: <strong>contact@shyboti.de</strong>.</p>
        </section>
        <section>
          <h2>7. Cookies &amp; Local Storage</h2>
          <p>
            We use <code>localStorage</code> only for your session token. No
            tracking cookies or third-party analytics.
          </p>
        </section>
        <section>
          <h2>8. Security</h2>
          <p>
            OAuth tokens stored server-side, used only for authorised API
            requests. HTTPS for all connections.
          </p>
        </section>
        <section>
          <h2>9. Third-Party Services</h2>
          <ul>
            <li>
              <strong>Twitch Interactive, Inc.</strong> -
              <a
                href="https://www.twitch.tv/p/legal/privacy-policy/"
                target="_blank"
                rel="noopener"
                >twitch.tv/p/legal/privacy-policy</a
              >
            </li>
            <li><strong>Spanix</strong> - logs.spanix.team</li>
            <li><strong>7TV</strong> - 7tv.app</li>
          </ul>
          <p>
            ShyBoti is <strong>not affiliated</strong> with any of the above
            services.
          </p>
        </section>
        <section>
          <h2>10. Changes</h2>
          <p>
            We may update this policy. The date at the top reflects the last
            change.
          </p>
        </section>
        <section>
          <h2>11. Contact</h2>
          <p>Questions? Contact <strong>contact@shyboti.de</strong>.</p>
        </section>
      </template>
      <!-- ^^^ english ^^^ -->
    </div>
  </div>
</template>

<style scoped>
.privacy {
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 24px 48px;
  font-size: 13px;
  line-height: 1.8;
}
.privacy-title {
  font-size: 26px;
  font-weight: 700;
  color: #e0e0e0;
  margin-bottom: 4px;
}
.privacy-meta {
  font-size: 11px;
  color: #555;
  margin-bottom: 28px;
}
.notice {
  background: #1a1025;
  border: 1px solid #6f2bff44;
  border-left: 3px solid #6f2bff;
  padding: 12px 16px;
  font-size: 12px;
  color: #aaa;
  margin-bottom: 32px;
  line-height: 1.7;
}
.notice strong {
  color: #e0e0e0;
}
section {
  margin-bottom: 28px;
  padding-bottom: 28px;
  border-bottom: 1px solid #1e1e24;
}
section:last-child {
  border-bottom: none;
}
h2 {
  font-size: 15px;
  font-weight: 700;
  color: #e0e0e0;
  margin-bottom: 10px;
}
h3 {
  font-size: 13px;
  font-weight: 700;
  color: #c0c0c0;
  margin: 14px 0 6px;
}
p {
  margin-bottom: 8px;
  color: #aaa;
}
ul {
  margin: 6px 0 10px 20px;
  color: #aaa;
}
li {
  margin-bottom: 4px;
}
strong {
  color: #e0e0e0;
}
a {
  color: #9d6cff;
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
code {
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 11px;
  background: #1e1e24;
  padding: 1px 5px;
  color: #9d6cff;
}
@media (max-width: 680px) {
  .privacy {
    padding: 20px 16px 40px;
  }
  .privacy-title {
    font-size: 20px;
  }
}
</style>
