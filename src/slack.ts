export interface SlackPayload { text: string; blocks: unknown[] }

export async function sendToSlack(payload: SlackPayload): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL;

  if (webhook) {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
    return;
  }

  if (token && channel) {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, ...payload, unfurl_links: false }),
    });
    const body = (await res.json()) as { ok: boolean; error?: string };
    if (!body.ok) throw new Error(`Slack chat.postMessage failed: ${body.error}`);
    return;
  }

  throw new Error('Slack not configured: set SLACK_WEBHOOK_URL, or SLACK_BOT_TOKEN + SLACK_CHANNEL');
}
