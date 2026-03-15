<template>
  <div class="privacy">
    <div class="privacy-inner">

      <h1 class="privacy-title">Privacy Policy</h1>
      <p class="privacy-meta">Last updated: March 2026 · shyboti.de</p>

      <div class="notice">
        ShyBoti and shyboti.de are independent projects and are <strong>not affiliated with, endorsed by, or sponsored by Twitch Interactive, Inc.</strong>
      </div>

      <section>
        <h2>1. Who is ShyBoti</h2>
        <p>ShyBoti (<strong>shyboti.de</strong>) is a personal Twitch bot dashboard project. It provides broadcasters and their moderators with tools to manage chat commands, automations, moderation rules, and chat logs for Twitch channels.</p>
      </section>

      <section>
        <h2>2. What Data do We collect</h2>

        <h3>2.1 Twitch OAuth Data</h3>
        <p>When you log in via Twitch, shyboti receives and stores:</p>
        <ul>
          <li>Your Twitch username and display name</li>
          <li>Your Twitch user ID</li>
          <li>OAuth access and refresh tokens (used to make API calls on your behalf)</li>
        </ul>
        <p>We do <strong>not</strong> receive or store your email address, payment information, or password.</p>

        <h3>2.2 Chat Logs</h3>
        <p>The Logs feature proxies publicly available chat history from <strong>Spanix</strong> (logs.spanix.team), a third-party Twitch log service. shyboti does not store this data itself - it is fetched live and displayed in your browser. Users may opt out of having their messages displayed in our log viewer by using the opt-out function in the dashboard.</p>

        <h3>2.3 Configuration Data</h3>
        <p>We store the settings you configure through the dashboard, including:</p>
        <ul>
          <li>Custom commands, timers, triggers, and moderation rules for your channel</li>
          <li>Role and permission settings for your moderators</li>
          <li>Channel feature flags (e.g. mention trigger on/off)</li>
        </ul>

        <h3>2.4 Activity Logs</h3>
        <p>We maintains an activity log per channel that records actions taken through the dashboard (e.g. commands added or edited, timeouts issued). This is visible to the broadcaster and authorised moderators only.</p>

        <h3>2.5 Session Data</h3>
        <p>We store a session token in your browser's <code>localStorage</code> to keep you logged in. This token is invalidated when you log out.</p>
      </section>

      <section>
        <h2>3. How We use Your Data</h2>
        <ul>
          <li>To authenticate you via Twitch and identify which channels you have access to</li>
          <li>To operate the bot on your channel (sending messages, managing timers, applying moderation rules)</li>
          <li>To display your channel's configuration and activity in the dashboard</li>
          <li>To sync settings between channels where you have configured command sync</li>
        </ul>
        <p>We do<strong>not</strong> sell, share, or use your data for advertising.</p>
      </section>

      <section>
        <h2>4. Data Sharing</h2>
        <p>We do<strong>not</strong> sell or share your personal data with third parties, except:</p>
        <ul>
          <li><strong>Twitch API</strong> - necessary to authenticate users and operate the bot (read follower counts, subscriptions, etc.)</li>
          <li><strong>Spanix</strong> - to retrieve publicly available chat logs when you use the Logs feature</li>
          <li><strong>7TV</strong> - to fetch emote sets for your channel</li>
        </ul>
        <p>All of the above are purely technical integrations required to provide the service.</p>
      </section>

      <section>
        <h2>5. Data Retention</h2>
        <p>Your configuration data is retained as long as your channel uses ShyBoti. If you remove the bot from your channel, you may request deletion of all stored data by contacting <strong>.shyly</strong> on discord or through the Twitch channel <strong>itsshyly</strong> or <strong>shyboti</strong></p>
      </section>

      <section>
        <h2>6. Your Rights</h2>
        <p>Depending on your jurisdiction you may have the right to:</p>
        <ul>
          <li>Opt out of log display (available directly in the dashboard)</li>
          <li>Revoke Twitch OAuth access at any time via your <a href="https://www.twitch.tv/settings/connections" target="_blank" rel="noopener">Twitch connections settings</a></li>
        </ul>
      </section>

      <section>
        <h2>7. Cookies &amp; Local Storage</h2>
        <p>We use <code>localStorage</code> to store your session token. We do not use tracking cookies or third-party analytics. No advertising or marketing cookies are present on this site.</p>
      </section>

      <section>
        <h2>8. Security</h2>
        <p>OAuth tokens are stored server-side and are used exclusively to make authorised Twitch API requests. Sessions are invalidated on logout. We use HTTPS for all connections.</p>
      </section>

      <section>
        <h2>9. Third-Party Services</h2>
        <p>ShyBoti integrates with the following external services. Their own privacy policies apply to data processed by them:</p>
        <ul>
          <li><strong>Twitch Interactive, Inc.</strong> - <a href="https://www.twitch.tv/p/legal/privacy-policy/" target="_blank" rel="noopener">twitch.tv/p/legal/privacy-policy</a></li>
          <li><strong>Spanix</strong> - logs.spanix.team (third-party Twitch log archive)</li>
          <li><strong>7TV</strong> - 7tv.app (third-party emote platform)</li>
        </ul>
        <p>ShyBoti is <strong>not affiliated with, endorsed by, or sponsored by</strong> any of the above services.</p>
      </section>

      <section>
        <h2>10. Changes to This Policy</h2>
        <p>We may update this privacy policy from time to time. The date at the top of this page reflects when it was last changed. Continued use of shyboti.de after changes constitutes acceptance of the updated policy.</p>
      </section>

      <section>
        <h2>11. Contact</h2>
        <p>Questions about this privacy policy? Reach out via Twitch: <strong>itsshyly</strong> or on discord: <strong>.shyly</strong></p>
      </section>

    </div>
  </div>
</template>

<style scoped>
.privacy {
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 24px 48px;
  color: #ccc;
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

strong { color: #e0e0e0; }

a {
  color: #9d6cff;
  text-decoration: none;
}
a:hover { text-decoration: underline; }

code {
  font-family: 'Consolas', 'Fira Mono', monospace;
  font-size: 11px;
  background: #1e1e24;
  padding: 1px 5px;
  color: #9d6cff;
}

@media (max-width: 680px) {
  .privacy { padding: 20px 16px 40px; }
  .privacy-title { font-size: 20px; }
}
</style>
