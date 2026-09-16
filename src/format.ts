import { formatUnits } from 'viem';
import { SLACK_MAX_TXS_PER_CHAIN, TOKEN_DECIMALS, TOKEN_SYMBOL } from './config.js';
import type { Report, TxSummary } from './report.js';

export function fmtAmount(wei: bigint, decimals = 2): string {
  const n = Number(formatUnits(wei, TOKEN_DECIMALS));
  // Dust amounts that would round to zero are shown with more precision instead of "0.0000".
  const max = n > 0 && n < 10 ** -decimals ? 8 : decimals;
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: max });
}

/** `part / whole` as a percentage string, e.g. "2.53%". */
export function fmtPct(part: bigint, whole: bigint): string {
  if (whole === 0n) return 'n/a';
  const bps = Number((part * 1_000_000n) / whole) / 10_000; // 4 decimal places of precision
  return bps.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

export function fmtTs(ts: number): string {
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

function pad(s: string, n: number, right = false): string {
  return right ? s.padStart(n) : s.padEnd(n);
}

/** Fixed-width table; first column left-aligned, the rest right-aligned; last row is the total. */
function table(head: string[], rows: string[][]): string {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (row: string[]) => row.map((cell, i) => pad(cell, w[i], i > 0)).join('  ');
  const sep = w.map((n) => '-'.repeat(n)).join('  ');
  return [line(head), sep, ...rows.slice(0, -1).map(line), sep, line(rows[rows.length - 1])].join('\n');
}

/** Claims per chain: last day and all-time. */
export function summaryTable(r: Report): string {
  const rows = r.chains.map((c) => [
    c.chain.name,
    c.error ? 'ERR' : fmtAmount(c.daily.amount),
    c.error ? '-' : String(c.daily.txCount),
    c.error ? 'ERR' : fmtAmount(c.total.amount),
    c.error ? '-' : String(c.total.txCount),
  ]);
  rows.push(['TOTAL', fmtAmount(r.daily.amount), String(r.daily.txCount), fmtAmount(r.total.amount), String(r.total.txCount)]);
  return table(['Chain', `Day ${TOKEN_SYMBOL}`, 'Day tx', `All-time ${TOKEN_SYMBOL}`, 'All tx'], rows);
}

/** Budget per chain: how much of it is claimed (last day / all-time) and what the multisig currently holds. */
export function budgetTable(r: Report): string {
  const rows = r.chains.map((c) => [
    c.chain.name,
    fmtAmount(c.budget),
    c.error ? 'ERR' : fmtAmount(c.daily.amount),
    c.error ? 'ERR' : fmtPct(c.daily.amount, c.budget),
    c.error ? 'ERR' : fmtAmount(c.total.amount),
    c.error ? 'ERR' : fmtPct(c.total.amount, c.budget),
    c.error ? 'ERR' : fmtAmount(c.multisigBalance),
  ]);
  rows.push(['TOTAL', fmtAmount(r.budget), fmtAmount(r.daily.amount), fmtPct(r.daily.amount, r.budget), fmtAmount(r.total.amount), fmtPct(r.total.amount, r.budget), fmtAmount(r.multisigBalance)]);
  return table(['Chain', 'Budget', 'Day claimed', 'Day %', 'All-time claimed', 'All-time %', `Multisig ${TOKEN_SYMBOL}`], rows);
}

export function consoleReport(r: Report, opts: { txs?: boolean } = {}): string {
  const out: string[] = [];
  out.push(`Merkl ${TOKEN_SYMBOL} claims — Distributor 0x3Ef3…9Ae`);
  out.push(`Window: ${fmtTs(r.windowStart)} → ${fmtTs(r.windowEnd)}   |   All-time since ${fmtTs(r.launchTimestamp)}`);
  out.push('');
  out.push(summaryTable(r));
  out.push('');
  out.push(budgetTable(r));
  out.push('');
  out.push(`All chains: ${fmtAmount(r.total.amount)} / ${fmtAmount(r.budget)} ${TOKEN_SYMBOL} claimed (${fmtPct(r.total.amount, r.budget)}), last day ${fmtAmount(r.daily.amount)} ${TOKEN_SYMBOL} (${fmtPct(r.daily.amount, r.budget)}), multisig holds ${fmtAmount(r.multisigBalance)} ${TOKEN_SYMBOL}`);

  const failed = r.chains.filter((c) => c.error);
  for (const c of failed) out.push(`${c.chain.name}: ERROR — ${c.error}`);

  if (opts.txs) {
    out.push('');
    out.push('Last-day transactions:');
    for (const c of r.chains) {
      if (c.error) continue;
      if (c.dailyTxs.length === 0) { out.push(`  ${c.chain.name}: none`); continue; }
      out.push(`  ${c.chain.name} (${c.dailyTxs.length} tx, blocks ${c.windowStartBlock}–${c.toBlock}):`);
      for (const t of c.dailyTxs) out.push(`    ${fmtTs(t.timestamp)}  ${pad(fmtAmount(t.amount, 4), 14, true)} ${TOKEN_SYMBOL}  ${c.chain.explorerTx(t.txHash)}`);
    }
  }
  return out.join('\n');
}

function slackTxLine(t: TxSummary, link: (h: string) => string): string {
  const who = t.users.length === 1 ? short(t.users[0]) : `${t.users.length} users`;
  return `• <${link(t.txHash)}|${short(t.txHash)}> — *${fmtAmount(t.amount, 4)} ${TOKEN_SYMBOL}* — ${who} — ${fmtTs(t.timestamp).slice(0, 16)}`;
}

export function slackMessage(r: Report): { text: string; blocks: unknown[] } {
  const date = new Date(r.windowEnd * 1000).toISOString().slice(0, 10);
  const text = `Merkl ${TOKEN_SYMBOL} claims ${date}: last day ${fmtAmount(r.daily.amount)} ${TOKEN_SYMBOL} in ${r.daily.txCount} tx · all-time ${fmtAmount(r.total.amount)} / ${fmtAmount(r.budget)} ${TOKEN_SYMBOL} (${fmtPct(r.total.amount, r.budget)}) in ${r.total.txCount} tx`;

  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: `Merkl ${TOKEN_SYMBOL} claims — ${date}` } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Last day*\n${fmtAmount(r.daily.amount)} ${TOKEN_SYMBOL} (${fmtPct(r.daily.amount, r.budget)} of budget)\n${r.daily.txCount} tx · ${r.daily.uniqueUsers} claimers` },
        { type: 'mrkdwn', text: `*All-time*\n${fmtAmount(r.total.amount)} / ${fmtAmount(r.budget)} ${TOKEN_SYMBOL} (${fmtPct(r.total.amount, r.budget)})\n${r.total.txCount} tx · ${r.total.uniqueUsers} claimers` },
        { type: 'mrkdwn', text: `*Multisig balance*\n${fmtAmount(r.multisigBalance)} ${TOKEN_SYMBOL} native across all chains` },
      ],
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Window ${fmtTs(r.windowStart)} → ${fmtTs(r.windowEnd)} · since launch ${fmtTs(r.launchTimestamp)}` }] },
    { type: 'section', text: { type: 'mrkdwn', text: '*Claims*\n```' + summaryTable(r) + '```' } },
    { type: 'section', text: { type: 'mrkdwn', text: '*Budget usage*\n```' + budgetTable(r) + '```' } },
  ];

  for (const c of r.chains) {
    if (c.error) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${c.chain.name}* — :warning: ${c.error}` } });
      continue;
    }
    if (c.dailyTxs.length === 0) continue;
    const shown = c.dailyTxs.slice(0, SLACK_MAX_TXS_PER_CHAIN);
    const lines = shown.map((t) => slackTxLine(t, c.chain.explorerTx));
    if (c.dailyTxs.length > shown.length) lines.push(`_…and ${c.dailyTxs.length - shown.length} more_`);
    // Slack caps a section at 3000 chars; chunk the list if needed.
    const chunks: string[] = [];
    let cur = `*${c.chain.name}* — ${c.dailyTxs.length} tx, ${fmtAmount(c.daily.amount)} ${TOKEN_SYMBOL}\n`;
    for (const l of lines) {
      if (cur.length + l.length + 1 > 2900) { chunks.push(cur); cur = ''; }
      cur += l + '\n';
    }
    chunks.push(cur);
    for (const ch of chunks) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: ch.trimEnd() } });
  }

  return { text, blocks: blocks.slice(0, 50) };
}
