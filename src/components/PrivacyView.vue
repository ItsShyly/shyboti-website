<template>
  <div class="privacy">
    <div class="privacy-inner">

      <h1 class="privacy-title">Datenschutzerklärung</h1>
      <p class="privacy-meta">Zuletzt aktualisiert: März 2026 · shyboti.de</p>

      <div class="notice">
        ShyBoti und shyboti.de sind unabhängige Projekte und stehen in keiner Verbindung zu
        <strong>Twitch Interactive, Inc.</strong> und werden von dieser weder unterstützt noch gesponsert.
        Twitch ist eine eingetragene Marke von Twitch Interactive, Inc.
        Alle Twitch-bezogenen Marken und Markenmerkmale gehören ihren jeweiligen Eigentümern.
      </div>

      <section>
        <h2>1. Wer wir sind</h2>
        <p>ShyBoti (<strong>shyboti.de</strong>) ist ein privates Twitch-Bot-Dashboard-Projekt. Es bietet Broadcastern und ihren Moderatoren Werkzeuge zur Verwaltung von Chat-Commands, Automationen, Moderationsregeln und Chat-Logs für Twitch-Kanäle.</p>
      </section>

      <section>
        <h2>2. Welche Daten wir erheben</h2>

        <h3>2.1 Twitch OAuth-Daten</h3>
        <p>Wenn du dich über Twitch anmeldest, erhalten und speichern wir:</p>
        <ul>
          <li>Deinen Twitch-Benutzernamen und Anzeigenamen</li>
          <li>Deine Twitch-Benutzer-ID</li>
          <li>OAuth-Zugriffs- und Refresh-Tokens (werden für API-Aufrufe in deinem Namen verwendet)</li>
        </ul>
        <p>Wir erhalten oder speichern weder deine E-Mail-Adresse noch Zahlungsinformationen oder dein Passwort.</p>

        <h3>2.2 Chat-Logs</h3>
        <p>Die Logs-Funktion leitet öffentlich verfügbaren Chatverlauf von <strong>Spanix</strong> (logs.spanix.team) weiter, einem Twitch-Log-Dienst von Drittanbietern. Wir speichern diese Daten nicht selbst - sie werden live abgerufen und in deinem Browser angezeigt. Nutzer können dem Anzeigen ihrer Nachrichten in den Logs über das Dashboard in den Settings widersprechen.</p>

        <h3>2.3 Konfigurationsdaten</h3>
        <p>Wir speichern die Einstellungen, die du über das Dashboard konfigurierst:</p>
        <ul>
          <li>Eigene Commands, Timer, Trigger, Moderationsregeln und Settings für deinen Kanal</li>
          <li>Rollen- und Berechtigungseinstellungen für deine Moderatoren</li>
        </ul>

        <h3>2.4 Aktivitätsprotokolle</h3>
        <p>Wir führen pro Kanal ein Aktivitätsprotokoll über Aktionen, die über das Dashboard durchgeführt wurden. Dies ist nur für den Broadcaster und autorisierte Moderatoren sichtbar.</p>

        <h3>2.5 Sitzungsdaten</h3>
        <p>Wir speichern ein Sitzungstoken im <code>localStorage</code> deines Browsers, um dich eingeloggt zu halten. Dieses Token wird beim Abmelden ungültig gemacht.</p>
      </section>

      <section>
        <h2>3. Wie wir deine Daten verwenden</h2>
        <p>Wir verwenden deine Daten ausschließlich um:</p>
        <ul>
          <li>Dich über Twitch zu authentifizieren und zu ermitteln, auf welche Kanäle du Zugriff hast</li>
          <li>Den Bot auf deinem Kanal zu betreiben (Nachrichten senden, Timer verwalten, Moderationsregeln anwenden)</li>
          <li>Deine Kanalkonfiguration und -aktivität im Dashboard anzuzeigen</li>
          <li>Einstellungen zwischen Kanälen zu synchronisieren, wenn du die Sync-Funktion konfiguriert hast</li>
        </ul>
        <p><strong>Wir verkaufen, teilen oder verwenden deine Daten nicht für Werbezwecke oder sonstiges.</strong></p>
      </section>

      <section>
        <h2>4. Datenweitergabe</h2>
        <p>Wir verkaufen oder teilen deine persönlichen Daten nicht mit Dritten. Ausschließlich für den technischen Betrieb notwendige Integrationen:</p>
        <ul>
          <li><strong>Twitch API</strong> - zur Authentifizierung und zum Betrieb des Bots</li>
          <li><strong>Spanix</strong> - zum Abrufen öffentlich verfügbarer Chat-Logs</li>
          <li><strong>7TV</strong> - zum Laden von Emote-Sets für deinen Kanal</li>
        </ul>
      </section>

      <section>
        <h2>5. Datenspeicherung</h2>
        <p>Deine Konfigurationsdaten werden gespeichert, solange dein Kanal ShyBoti verwendet. Wenn du den Bot entfernst, kannst du die Löschung aller gespeicherten Daten beantragen, indem du uns kontaktierst. Aktivitätsprotokolle werden für einen begrenzten Zeitraum aufbewahrt.</p>
      </section>

      <section>
        <h2>6. Deine Rechte</h2>
        <p>Du hast das Recht:</p>
        <ul>
          <li>Auf die Daten zuzugreifen, die wir über dich gespeichert haben</li>
          <li>Die Berichtigung oder Löschung deiner Daten zu verlangen</li>
          <li>Der Log-Anzeige zu widersprechen (direkt im Dashboard verfügbar)</li>
          <li>Den Twitch-OAuth-Zugriff jederzeit über deine <a href="https://www.twitch.tv/settings/connections" target="_blank" rel="noopener">Twitch-Verbindungseinstellungen</a> zu widerrufen</li>
        </ul>
        <p>Um diese Rechte auszuüben, schreibe eine DM über Twitch an: <strong>itsshyly</strong>.</p>
      </section>

      <section>
        <h2>7. Cookies &amp; Local Storage</h2>
        <p>Wir verwenden <code>localStorage</code> ausschließlich für dein Sitzungstoken. Wir verwenden keine Tracking-Cookies, Werbe-Cookies oder Analysetools von Drittanbietern.</p>
      </section>

      <section>
        <h2>8. Sicherheit</h2>
        <p>OAuth-Tokens werden serverseitig gespeichert und ausschließlich für autorisierte Twitch-API-Anfragen verwendet. Sitzungen werden beim Abmelden ungültig gemacht. Alle Verbindungen verwenden HTTPS.</p>
      </section>

      <section>
        <h2>9. Dienste von Drittanbietern</h2>
        <p>ShyBoti ist mit folgenden externen Diensten integriert. Deren eigene Datenschutzrichtlinien gelten jeweils:</p>
        <ul>
          <li><strong>Twitch Interactive, Inc.</strong> - <a href="https://www.twitch.tv/p/legal/privacy-policy/" target="_blank" rel="noopener">twitch.tv/p/legal/privacy-policy</a></li>
          <li><strong>Spanix</strong> - logs.spanix.team</li>
          <li><strong>7TV</strong> - 7tv.app</li>
        </ul>
        <p>ShyBoti steht in <strong>keiner Verbindung</strong> zu den oben genannten Diensten und wird von ihnen weder unterstützt noch gesponsert.</p>
      </section>

      <section>
        <h2>10. Änderungen dieser Richtlinie</h2>
        <p>Wir können diese Datenschutzerklärung von Zeit zu Zeit aktualisieren. Das Datum oben auf dieser Seite gibt an, wann sie zuletzt geändert wurde. Die weitere Nutzung von shyboti.de nach Änderungen gilt als Zustimmung.</p>
      </section>

      <section>
        <h2>11. Kontakt</h2>
        <p>Fragen zu dieser Datenschutzerklärung? Schreibe eine Twitch DM an: <strong>itsshyly</strong>.</p>
      </section>

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
.notice strong { color: #e0e0e0; }

section {
  margin-bottom: 28px;
  padding-bottom: 28px;
  border-bottom: 1px solid #1e1e24;
}
section:last-child { border-bottom: none; }

h2 { font-size: 15px; font-weight: 700; color: #e0e0e0; margin-bottom: 10px; }
h3 { font-size: 13px; font-weight: 700; color: #c0c0c0; margin: 14px 0 6px; }

p  { margin-bottom: 8px; color: #aaa; }
ul { margin: 6px 0 10px 20px; color: #aaa; }
li { margin-bottom: 4px; }

strong { color: #e0e0e0; }
a { color: #9d6cff; text-decoration: none; }
a:hover { text-decoration: underline; }
code { font-family: 'Consolas','Fira Mono',monospace; font-size: 11px; background: #1e1e24; padding: 1px 5px; color: #9d6cff; }

@media (max-width: 680px) {
  .privacy { padding: 20px 16px 40px; }
  .privacy-title { font-size: 20px; }
}
</style>
