# Cost model

**Headline:** **$0/month** within AWS Always Free tiers (default `PROVISIONED` 25/25 table), or **~$0.12–$4.80/month** on DynamoDB On-Demand (`PAY_PER_REQUEST`) from a personal repo up to a busy 20,000-webhook/day org.

The only cost trap is leaving a stack on the default `PROVISIONED` 25/25 table in an AWS account whose account-wide 25 RCU / 25 WCU free tier is already used by other tables (~$14.23/month). In that case, switch to `--billing-mode PAY_PER_REQUEST`.

## Monthly estimates by workload

Assumes 30-day months, default `--interval 15s` (172,800 polls/month per poller per owner), 50 ms average Lambda duration (256 MB `arm64`), 10 KB average stored item with pruned + gzipped payload (2 KB with `--payload-max-bytes 0`), and all 3 optional CloudWatch alarms enabled. Prices are AWS `us-east-1` list rates checked 2026-11-27.

| Workload                                                            | Webhooks / mo | Polls / mo | On-Demand (free tier available) | On-Demand (no free tier) | Provisioned 25/25 (free tier available) | Provisioned 25/25 (no free tier) |
| ------------------------------------------------------------------- | ------------: | ---------: | ------------------------------: | -----------------------: | --------------------------------------: | -------------------------------: |
| Personal / small repo (500/day, 1 poller, 1 owner, 10 KB)           |        15,000 |    172,800 |                       **$0.12** |                **$0.49** |                               **$0.00** |                           $14.60 |
| Active org (5,000/day, 1 poller via `serve`, 1 owner, 10 KB)        |       150,000 |    172,800 |                       **$1.05** |                **$1.47** |                               **$0.00** |                           $14.65 |
| Active org, envelopes only (5,000/day, 1 poller, 1 owner, 2 KB)     |       150,000 |    172,800 |                       **$0.23** |                **$0.65** |                               **$0.00** |                           $14.65 |
| Busy org (20,000/day, 1 poller via `serve`, 2 owners, 10 KB)        |       600,000 |    345,600 |                       **$4.17** |                **$4.81** |                               **$0.00** |                           $14.88 |
| 5 direct pollers, no `serve` (5,000/day, 5 pollers, 1 owner, 10 KB) |       150,000 |    864,000 |                       **$1.52** |                **$2.19** |                               **$0.00** |                           $14.91 |

> Note: DynamoDB's Always Free 25 RCU / 25 WCU allowance applies **only** to `PROVISIONED` tables, not `PAY_PER_REQUEST`. Under "free tier available", Lambda (1M requests + 400,000 GB-s), CloudWatch Alarms (10 standard metrics), CloudWatch Logs (5 GB), SNS email (1,000 emails), and DynamoDB storage (25 GB) are all $0. Under "no free tier", Lambda, alarms ($0.30), and provisioned capacity ($14.23) are billed from unit 1.

## Resources deployed

Defined in [`packages/relay/template.yaml`](../packages/relay/template.yaml):

| Resource                               | Configuration                                                            | Pricing basis (`us-east-1`, 2026-11-27)                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Lambda + Function URL                  | `nodejs24.x`, `arm64`, 256 MB, 10s timeout (no API Gateway)              | Free tier: 1M req + 400,000 GB-s/mo. Paid: $0.20 / 1M req + $0.0000133334 / GB-s                                    |
| DynamoDB table (`PROVISIONED` default) | 25 RCU / 25 WCU, 1-day TTL, no GSIs, no PITR                             | Free tier: 25 RCU + 25 WCU + 25 GB/mo (account-wide). Paid: $0.00065/WCU-hr + $0.00013/RCU-hr (~$14.23/mo at 25/25) |
| DynamoDB table (`PAY_PER_REQUEST`)     | On-Demand, 1-day TTL, no GSIs, no PITR                                   | $0.625 / 1M WRU, $0.125 / 1M RRU (no request free tier); 25 GB storage free, then $0.25/GB-mo                       |
| DynamoDB TTL deletions                 | Enabled on `expiresAt` (1 day)                                           | Free (0 WCU/WRU)                                                                                                    |
| CloudWatch Logs                        | 1-day retention, `SystemLogLevel: WARN`, payloads never logged           | Free tier: 5 GB ingestion + 5 GB archive/mo (effectively $0)                                                        |
| CloudWatch Alarms + SNS (optional)     | Created only with `--alarm-email`: 3 standard alarms + 1 SNS email topic | Free tier: 10 standard alarm metrics + 1,000 SNS emails/mo. Paid: $0.30/mo for 3 alarms                             |

## What drives cost

1. **DynamoDB writes (WRUs) — ~80–90% of On-Demand spend when storing payloads.**
   - Every webhook runs one `PutItem` (`packages/relay/src/webhook.ts`).
   - DynamoDB bills 1 WRU per 1 KB (rounded up). Dropping `installation`, `repository`, and `organization` and gzipping keeps typical items around 3–15 KB (modeled at 10 KB = 10 WRUs/webhook). Envelope-only items (`--payload-max-bytes 0`) are ~1–2 KB (2 WRUs/webhook).
2. **DynamoDB reads (RRUs) — driven by poll frequency, poller count, and the 60s overlap window.**
   - Each `GET /events` poll does one eventually consistent token `GetItem` (0.5 RRU) plus one `Query` (minimum 0.5 RRU, or 0.5 RRU per 4 KB read).
   - Because queries look back 60 seconds (`OVERLAP_MS = 60_000`) to handle out-of-order deliveries, each webhook is read roughly `60 / interval_seconds` times per poller (~4 times at the default 15s interval).
   - Server-side `filters` reduce Lambda response size, not DynamoDB reads: the table is partitioned by `owner`, so every event in the time window is scanned first.
   - Multi-owner polling (`--owner a,b`) queries each owner's partition separately.
3. **Lambda invocations and duration — usually $0.**
   - Total monthly invocations = `webhooks + (2,592,000 / interval_seconds) × pollers × owners`.
   - At 256 MB and 50 ms average duration, 1M invocations use 12,500 GB-s (~3% of the 400,000 GB-s free tier). Outside the free tier, 1M invocations cost ~$0.37.
4. **Storage, TTL, logs, and alarms — negligible.**
   - With 1-day TTL, even 20,000 webhooks/day at 10 KB holds ~200 MB at steady state (<1% of the 25 GB free tier).

## Choosing `PROVISIONED` vs. `PAY_PER_REQUEST`

- **Use default `PROVISIONED` 25/25** when your AWS account has the 25 RCU / 25 WCU Always Free tier available, sustained webhook volume stays under ~25 KB/s (~2.5 webhooks/sec at 10 KB), and combined read load from all pollers stays under 25 RCU/s (about 12.5 RCU/s per poller at 10 KB items and the 15 s default interval). DynamoDB burst capacity absorbs short spikes.
- **Use `--billing-mode PAY_PER_REQUEST`** when:
  - your AWS account already consumes its 25 RCU / 25 WCU free tier on other tables; or
  - you have an org-wide install with payloads that can burst past 25 WCU/sec and trigger throttling (`relay-throttles` alarm).

```sh
hook-harness update --billing-mode PAY_PER_REQUEST
```

## Knobs to lower spend

- **Share one poller:** run `hook-harness serve` on a machine with multiple agents so only one process polls the relay.
- **Store envelopes only:** `hook-harness update --payload-max-bytes 0` cuts item size from ~10 KB to ~2 KB (~5× fewer WRUs and smaller query reads) when agents fetch details from the GitHub API anyway.
- **Trim App subscriptions:** the relay stores every event the GitHub App sends; unsubscribe from unused events in the App settings ([docs/github-app.md](github-app.md#subscribe-to-events)).
- **Increase `--interval`:** moving from `15s` to `30s` or `60s` halves or quarters poll requests, token reads, and overlap re-reads.
- **Adjust `PayloadDrop`:** keep the default `repository,organization` (or add more top-level keys via `--payload-drop`).

## Checking actual spend and usage

Rather than relying on estimates, inspect your deployed stack directly:

- **AWS Cost Explorer:** filter by service (`AWS Lambda`, `Amazon DynamoDB`, `Amazon CloudWatch`) or by stack resource.
- **DynamoDB capacity:** check `ConsumedWriteCapacityUnits`, `ConsumedReadCapacityUnits`, and `WriteThrottleEvents` on `<stack>-events` in CloudWatch.
- **Lambda usage:** check `Invocations` and `Duration` on `<stack>-relay` in CloudWatch.
- **Current AWS rates for your region:** [Lambda pricing](https://aws.amazon.com/lambda/pricing/), [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/), [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), [SNS pricing](https://aws.amazon.com/sns/pricing/).
