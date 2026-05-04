/**
 * Discord Webhook Notifier
 * Sends task completion notifications to Discord via webhook
 * Only sends summary (success/fail/total) - no per-URL details
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Send a notification to Discord webhook
 * @param {string} webhookUrl - Discord webhook URL
 * @param {object} data - Task completion data
 * @param {number} data.successCount - Number of successful requests
 * @param {number} data.failCount - Number of failed requests
 * @param {number} data.total - Total requests attempted
 * @param {string} [data.url] - Target URL
 * @param {string[]} [data.urls] - Target URLs (multiple)
 * @param {number} [data.duration] - Duration in ms
 * @param {string} [data.mode] - 'normal' or 'background'
 * @returns {Promise<boolean>} - Whether notification was sent successfully
 */
async function sendDiscordNotification(webhookUrl, data) {
  if (!webhookUrl || !webhookUrl.trim()) {
    return false;
  }

  // Validate Discord webhook URL format
  const url = webhookUrl.trim();
  if (!url.includes('discord.com/api/webhooks/') && !url.includes('discordapp.com/api/webhooks/')) {
    console.log('[Discord] Invalid webhook URL format');
    return false;
  }

  const { successCount = 0, failCount = 0, total = 0, url: targetUrl, urls, duration, mode = 'normal' } = data;
  const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;

  // Determine target display
  let targetDisplay = 'Unknown';
  if (urls && urls.length > 1) {
    targetDisplay = `${urls.length} URLs`;
  } else if (targetUrl) {
    targetDisplay = targetUrl.length > 50 ? targetUrl.substring(0, 50) + '...' : targetUrl;
  }

  // Duration formatting
  let durationDisplay = '';
  if (duration) {
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      durationDisplay = `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      durationDisplay = `${minutes}m ${seconds % 60}s`;
    } else {
      durationDisplay = `${seconds}s`;
    }
  }

  // Status emoji and color
  let statusEmoji = '✅';
  let color = 0x00ff00; // green
  if (successRate < 50) {
    statusEmoji = '⚠️';
    color = 0xffaa00; // orange
  }
  if (successRate === 0) {
    statusEmoji = '❌';
    color = 0xff0000; // red
  }

  // Build Discord embed
  const embed = {
    title: `${statusEmoji} Task Completed`,
    color,
    fields: [
      {
        name: '🎯 Target',
        value: targetDisplay,
        inline: false
      },
      {
        name: '✅ Success',
        value: `${successCount}`,
        inline: true
      },
      {
        name: '❌ Failed',
        value: `${failCount}`,
        inline: true
      },
      {
        name: '📊 Total',
        value: `${total}`,
        inline: true
      },
      {
        name: '📈 Success Rate',
        value: `${successRate}%`,
        inline: true
      }
    ],
    footer: {
      text: `Watcher Web • ${mode === 'background' ? 'Background' : 'Normal'} Mode`
    },
    timestamp: new Date().toISOString()
  };

  // Add duration if available
  if (durationDisplay) {
    embed.fields.push({
      name: '⏱️ Duration',
      value: durationDisplay,
      inline: true
    });
  }

  const payload = JSON.stringify({
    embeds: [embed]
  });

  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      const req = protocol.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[Discord] Notification sent successfully');
            resolve(true);
          } else if (res.statusCode === 204) {
            console.log('[Discord] Notification sent successfully (204)');
            resolve(true);
          } else {
            console.log(`[Discord] Failed to send notification: ${res.statusCode} ${body}`);
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        console.log(`[Discord] Error sending notification: ${err.message}`);
        resolve(false);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        console.log('[Discord] Request timed out');
        resolve(false);
      });

      req.write(payload);
      req.end();
    } catch (err) {
      console.log(`[Discord] Error: ${err.message}`);
      resolve(false);
    }
  });
}

module.exports = { sendDiscordNotification };
