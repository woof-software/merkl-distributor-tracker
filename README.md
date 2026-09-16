# Merkl COMP claims tracker

Tracks `claim` calls on the Merkl Distributor (`0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae`) for the
wrapped COMP token (`0x53350F755340aAee07277CF69574CF70ac4746dc`) across **Ethereum, Base, Arbitrum,
Unichain, Polygon and Optimism**, and reports:

- **Last day** — claimed amount, transaction count, unique claimers, % of budget, and the list of transactions
- **All time** — claimed amount and transaction count since campaign launch (2026‑09‑10 22:19:47 UTC),
  claimed / budget and % of budget — per chain and across all chains
- **Multisig balance** — native COMP held by `0xf06DFee756D79065d30337D0cE2A366A85318bea` on each chain

It runs as a local CLI and as a daily job that posts the same report to Slack.

## How it works

Every run reads `Claimed(address indexed user, address indexed token, uint256 amount)` events emitted by
the Distributor, filtered by the COMP token address, from the launch block to the latest block on each
chain (`eth_getLogs`, split recursively if the provider rejects the range). The "last day" window is
converted to a block range via a timestamp → block binary search, so it is exact w.r.t. block timestamps.

The multisig balance is `balanceOf(0xf06D…8bea)` on each chain's native COMP token, read at the same block
as the claims. Campaign budgets and native COMP addresses are constants in [`src/config.ts`](src/config.ts):

| Chain | Budget (COMP) | Native COMP |
| --- | ---: | --- |
| Ethereum | 92,947.7942 | `0xc00e94Cb662C3520282E6f5717214004A7f26888` |
| Base | 3,658.6913 | `0x9e1028F5F1D5eDE59748FFceE5532509976840E0` |
| Arbitrum | 7,278.8073 | `0x354A6dA3fcde098F8389cad84b0182725c6C91dE` |
| Unichain | 917.7690 | `0xdf78e4F0A8279942ca68046476919A90f2288656` |
| Polygon | 625.2496 | `0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c` |
| Optimism | 1,499.3714 | `0x7e7d4467112689329f7E06571eD0E8CbAd4910eE` |

The launch block per chain is looked up once and cached in `data/launch-block-<chain>.json`; nothing
else is persisted — all numbers come straight from the chain on every run.

## Setup

```bash
npm install
cp .env.example .env   # fill in RPC URLs and Slack credentials
```

`.env` variables:

| Variable | Purpose |
| --- | --- |
| `RPC_MAINNET`, `RPC_BASE`, `RPC_ARBITRUM`, `RPC_UNICHAIN`, `RPC_POLYGON`, `RPC_OPTIMISM` | JSON‑RPC endpoints (Alchemy works out of the box) |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook — **or** |
| `SLACK_BOT_TOKEN` + `SLACK_CHANNEL` | Bot token (`chat:write`) and channel id/name |
| `WINDOW_HOURS` | Length of the "last day" window (default `24`) |
| `SLACK_MAX_TXS_PER_CHAIN` | Cap on transactions listed per chain in Slack (default `20`) |

## Local usage

```bash
npm run report                     # text report: claims + budget tables
npm run report -- --txs            # also list last-day transactions per chain
npm run report -- --json           # machine-readable
npm run report -- --chains base,unichain
npm run report -- --hours 48       # wider window
npm run report -- --at 2026-09-16T00:00:00Z   # window ending at a fixed time (e.g. a calendar day)
npm run report -- --slack-preview  # print the Slack payload without sending
npm run report -- --slack          # print AND send to Slack
```

Example output:

```
Chain     Day COMP  Day tx  All-time COMP  All tx
--------  --------  ------  -------------  ------
Ethereum     76.00      14       2,350.04     131
Base          0.27      11         122.92     118
Arbitrum      2.40       2          19.50      33
Unichain    228.10       6         229.80      15
Polygon       2.79       2           2.81       7
Optimism      6.05       3          11.82      24
--------  --------  ------  -------------  ------
TOTAL       315.61      38       2,736.88     328

Chain         Budget  Day claimed   Day %  All-time claimed  All-time %  Multisig COMP
--------  ----------  -----------  ------  ----------------  ----------  ----------
Ethereum   92,947.79        76.00   0.08%          2,350.04       2.53%    4,561.31
Base        3,658.69         0.27   0.01%            122.92       3.36%      971.87
Arbitrum    7,278.81         2.40   0.03%             19.50       0.27%    1,800.20
Unichain      917.77       228.10  24.85%            229.80      25.04%      229.09
Polygon       625.25         2.79   0.45%              2.81       0.45%       59.72
Optimism    1,499.37         6.05   0.40%             11.82       0.79%      138.03
--------  ----------  -----------  ------  ----------------  ----------  ----------
TOTAL     106,927.68       315.61   0.30%          2,736.88       2.56%    7,760.22
```

`Day %` / `All-time %` are the last‑day and all‑time claimed amounts as a share of that chain's budget;
the `TOTAL` row uses the sum of budgets. With `--chains`, totals cover only the selected chains.

Exit code is `2` if any chain failed (the report is still produced/sent with that chain marked as an error).

## Daily Slack report on a server

`npm run report:slack` sends the report and prints nothing else. Pick one of:

### GitHub Actions (no server needed)

[`.github/workflows/daily-report.yml`](.github/workflows/daily-report.yml) runs at 08:00 UTC daily.
Add the `RPC_*` and Slack variables as repository secrets (Settings → Secrets → Actions).
The workflow can also be triggered manually from the Actions tab.

### cron on a VPS

```bash
npm ci && npm run build
crontab -e
```

```
0 8 * * * cd /opt/merkl-distributor-tracker && /usr/bin/node dist/index.js --slack --quiet >> /var/log/merkl-report.log 2>&1
```

### Docker

```bash
docker build -t merkl-tracker .
docker run --rm --env-file .env -v merkl-data:/app/data merkl-tracker
```

Schedule the `docker run` with cron, or with a scheduler such as Ofelia / Kubernetes CronJob.

## Notes

- One transaction may contain several `Claimed` events (batch claims); "tx" counts distinct transaction
  hashes, "claim events" counts events, and per‑tx amounts are the sum of the token's events in that tx.
- Cross‑chain "unique claimers" is the sum of per‑chain unique addresses.
- The window is `[now − WINDOW_HOURS, now)`; running the job once every 24 h means daily figures add up to
  the all‑time figure. Use `--at` for calendar‑day aligned windows.
