# KCC-0010: Fee-on-Transfer Token Standard

| Field | Value |
|-------|-------|
| **KCC** | 0010 |
| **Category** | Asset Standard |
| **Title** | Fee-on-Transfer Token — Automatic Revenue Sharing |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |

## Abstract

A token that deducts a configurable fee from every transfer and routes it to designated recipients. Fees are enforced at the covenant level — no off-chain accounting, no missed payments.

## Specification

| # | Entrypoint | Caller | Description |
|---|-----------|--------|-------------|
| 1 | `transfer` | Holder | Send `amount`. Outputs split per `fee_schedule`. |
| 2 | `set_fee_schedule` | Owner | Configure fee recipients + basis points. Immutable after first call. |
| 3 | `mint` | Owner | Issue tokens. |
| 4 | `burn` | Holder | Destroy tokens. |

## State

```
fee_schedule: [{
  recipient          pubkey
  bps                uint16     // 200 = 2%
}]
total_collected: [{recipient, amount}]
owner               pubkey
frozen              bool
```

Sum of all `bps` must be ≤ 10000. Fees are deducted from the sent amount — the recipient receives `amount - fees`.

## Use Cases

| Use Case | Schedule | Benefit |
|----------|----------|---------|
| Platform fee | `[{platform: 200}]` | 2% automatic, auditable |
| Creator royalty | `[{artist: 500}, {label: 300}]` | Every transfer pays |
| Charity | `[{charity: 300}]` | Verifiable donation |
| Affiliate | `[{referrer: 100}]` | 1% trustless commission |

## Rules

1. `fee_schedule` is immutable after first `set_fee_schedule`.
2. Sum of all `bps` ≤ 10000.
3. Fees are deducted from the amount sent.
4. Transfer fails if any fee recipient address is unspendable.