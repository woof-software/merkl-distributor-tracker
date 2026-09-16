import { parseArgs } from 'node:util';
import { WINDOW_HOURS } from './config.js';
import { buildReport } from './report.js';
import { consoleReport, slackMessage } from './format.js';
import { sendToSlack } from './slack.js';

const { values } = parseArgs({
  options: {
    slack: { type: 'boolean', default: false },
    'slack-preview': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    txs: { type: 'boolean', default: false },
    quiet: { type: 'boolean', short: 'q', default: false },
    hours: { type: 'string' },
    at: { type: 'string' },
    chains: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`Usage: npm run report -- [options]

  --slack           Send the report to Slack (SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN+SLACK_CHANNEL)
  --slack-preview   Print the Slack payload as JSON without sending it
  --json            Print the report as JSON instead of text
  --txs             Also list last-day transactions per chain
  --quiet, -q       Do not print the text report (useful with --slack)
  --hours <n>       Length of the "last day" window in hours (default ${WINDOW_HOURS})
  --at <ISO date>   End of the window (default: now). Example: --at 2026-09-16T00:00:00Z
  --chains <list>   Comma-separated chain keys: ethereum,base,arbitrum,unichain,polygon,optimism
`);
  process.exit(0);
}

const report = await buildReport({
  windowHours: values.hours ? Number(values.hours) : WINDOW_HOURS,
  at: values.at ? Math.floor(Date.parse(values.at) / 1000) : undefined,
  chains: values.chains?.split(',').map((s) => s.trim()).filter(Boolean),
});

if (values.json) {
  console.log(JSON.stringify(report, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
} else if (!values.quiet) {
  console.log(consoleReport(report, { txs: values.txs }));
}

if (values['slack-preview']) {
  console.log(JSON.stringify(slackMessage(report), null, 2));
}

if (values.slack) {
  await sendToSlack(slackMessage(report));
  console.error('Sent to Slack.');
}

const failed = report.chains.filter((c) => c.error);
if (failed.length) {
  console.error(`Warning: ${failed.length} chain(s) failed: ${failed.map((c) => c.chain.name).join(', ')}`);
  process.exitCode = 2;
}
