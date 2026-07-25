# KCC-0011: Conditional Token Standard

| Field | Value |
|-------|-------|
| **KCC** | 0011 |
| **Category** | Asset Standard |
| **Title** | Conditional Token — Oracle-Gated Transfers |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |

## Abstract

A token whose transferability is gated on an oracle-attested condition. Tokens are locked until the condition is met. When an oracle attests fulfillment, transfers unlock. When the condition fails or expires, tokens revert.

## Specification

| # | Entrypoint | Caller | Description |
|---|-----------|--------|-------------|
| 1 | `mint` | Issuer | Issue conditional tokens to recipient |
| 2 | `transfer` | Holder | Transfer tokens. Fails if condition not met. |
| 3 | `resolve` | Oracle | Attest condition met or failed |
| 4 | `revert` | Issuer | Condition expired → tokens return |

## State

```
condition_type     enum       // PRICE_ABOVE, PRICE_BELOW, BLOCK_REACHED, ATTESTATION
condition_params   bytes32    // e.g. "KAS/USD > 0.10"
oracle_id          bytes32    // must reference an ACTIVE oracle operator
deadline           uint64     // condition must resolve by this block
revert_recipient   pubkey     // where tokens go if condition fails
status             enum       // PENDING, MET, FAILED, EXPIRED
```

## Condition Types

| Type | Params | Example |
|------|--------|---------|
| `PRICE_ABOVE` | `{pair, threshold}` | KAS/USD > 0.10 |
| `PRICE_BELOW` | `{pair, threshold}` | KAS/USD < 0.01 |
| `BLOCK_REACHED` | `{block}` | Block 1,000,000 |
| `ATTESTATION` | `{condition_hash}` | Milestone attested |

## Use Cases

- **SAFT delivery**: tokens unlock on network launch attestation
- **Performance bonus**: tokens vest when KAS exceeds price target
- **Milestone escrow**: payment released on delivery confirmation
- **Prediction market**: claim payout on oracle-reported outcome

## Rules

1. Condition parameters are immutable after deployment.
2. `transfer` checks condition via oracle — no manual verification.
3. If deadline passes with status PENDING, tokens revert.
4. Oracle check and transfer are atomic in one transaction.