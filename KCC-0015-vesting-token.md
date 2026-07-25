# KCC-0015: Vesting Token Standard

| Field | Value |
|-------|-------|
| **KCC** | 0015 |
| **Category** | Asset Standard |
| **Title** | Vesting Token — Time-Locked and Streaming Release |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |

## Abstract

A token that unlocks over time. Supports cliff, linear, streaming, and milestone-based vesting schedules. Tokens are issued immediately but cannot be transferred until unlocked.

## Specification

| # | Entrypoint | Caller | Description |
|---|-----------|--------|-------------|
| 1 | `issue` | Issuer | Issue vested tokens with schedule |
| 2 | `transfer` | Holder | Transfer unlocked portion |
| 3 | `claim` | Holder | Claim unlocked tokens to new UTXO |
| 4 | `revoke` | Issuer | Revoke unvested portion |
| 5 | `accelerate` | Issuer | Full unlock |

## Schedule Types

| Type | Parameters | Behavior |
|------|-----------|----------|
| Cliff | `cliff_block` | 0% until cliff, 100% after |
| Linear | `start_block, end_block` | 0%→100% over period |
| Streaming | `rate_per_block` | Continuous per-block release |
| Milestone | `condition_id` | Unlocks on oracle attestation |

## State

```
issuer              pubkey
holder              pubkey     // immutable
schedule_type       enum
schedule_params     bytes32
total_issued        uint64
total_unlocked      uint64
clawback_enabled    bool
```

## Use Cases

| Use Case | Schedule | Clawback |
|----------|----------|:--------:|
| SAFT delivery | Milestone | Yes |
| Team allocation | Linear, 4 years | Yes |
| Advisor grant | Cliff, 1 year | Yes |
| Payroll | Streaming | No |
| Subscription | Streaming | No |

## Rules

1. `holder` is immutable — vested tokens cannot be transferred pre-vest.
2. `transfer` fails if `amount > unlocked`.
3. Clawback only revokes unvested tokens.
4. Milestone vesting references conditional token oracle.
5. Streaming rate is immutable after `issue`.