/**
 * slackService.js
 * PowerGen_API/services/slackService.js
 *
 * Sends messages to a Slack channel via incoming webhook.
 * Set SLACK_WEBHOOK_URL in .env to enable.
 * If not set, all calls are silently no-ops.
 *
 * Usage:
 *   const { sendSlackAlert } = require('./slackService');
 *   await sendSlackAlert({ text: 'Critical site detected', color: 'danger', fields: [...] });
 */
'use strict';
const logger = require('../utils/logger');

async function sendSlackAlert({ text, title, color = 'warning', fields = [], footer }) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return; // Silently disabled if not configured

  const attachment = {
    color:    color === 'danger' ? '#dc2626' : color === 'good' ? '#16a34a' : '#f59e0b',
    title:    title || 'PowerGen Alert',
    text,
    fields:   fields.map(f => ({ title: f.label, value: f.value, short: !!f.short })),
    footer:   footer || 'GRATO PowerGen',
    ts:       Math.floor(Date.now() / 1000),
  };

  try {
    const fetch = require('node-fetch').default || require('node-fetch');
    const resp  = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ attachments: [attachment] }),
    });
    if (!resp.ok) logger.warn('[Slack] Webhook response:', resp.status, resp.statusText);
    else logger.info('[Slack] Alert sent:', title || text?.slice(0, 60));
  } catch (err) {
    logger.warn('[Slack] Failed to send (non-fatal):', err.message);
  }
}

module.exports = { sendSlackAlert };
