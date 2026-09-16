import { formatUnits } from 'viem';
import { TOKEN_DECIMALS, TOKEN_SYMBOL } from './config.js';
import type { Report } from './report.js';

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

/** Slack sections cap markdown at 3000 chars; keep tables monospaced and split on newlines. */
function slackCodeBlocks(text: string): unknown[] {
  const max = 2900;
  const blocks: unknown[] = [];
  let remaining = text;
  while (remaining.length) {
    let chunk = remaining.slice(0, max);
    if (remaining.length > max) {
      const lastNl = chunk.lastIndexOf('\n');
      if (lastNl > max / 2) chunk = chunk.slice(0, lastNl);
    }
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '```' + chunk + '```' } });
    remaining = remaining.slice(chunk.length).replace(/^\n/, '');
  }
  return blocks.slice(0, 50);
}

export function slackMessage(r: Report, opts: { txs?: boolean } = {}): { text: string; blocks: unknown[] } {
  const body = consoleReport(r, opts);
  return { text: body, blocks: slackCodeBlocks(body) };
}
