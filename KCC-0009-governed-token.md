# KCC-0009: Governed Token Standard

| Field | Value |
|-------|-------|
| **KCC** | 0009 |
| **Category** | Asset Standard |
| **Title** | Governed Token — Multi-Party Approval for Transfers |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |

## Abstract

A token requiring N-of-M authorized parties to approve every transfer. The governance lives in the token itself — not in a wallet wrapper. No single party can move funds. This does not exist as a standard on any blockchain.

## Motivation

Existing multisig wallets control entire accounts. A governed token controls the asset. Four differences:

| | Multisig Wallet | Governed Token |
|---|---|---|
| Control scope | All assets in wallet | This token only |
| Audit trail | Wallet transactions | Per-proposal on-chain |
| Recovery | Key rotation | Governor set change (requires quorum) |
| Composability | None — wallet-level | Covenant composable with commerce contracts |

## Specification

| # | Entrypoint | Caller | Description |
|---|-----------|--------|-------------|
| 1 | `propose` | Governor | Propose `amount` → `recipient` with `reason_hash` |
| 2 | `second` | Governor | Second the proposal. Must differ from proposer. |
| 3 | `veto` | Governor | Block proposal if veto power is configured |
| 4 | `execute` | Any | Quorum reached, delay elapsed → transfer executes |
| 5 | `cancel` | Proposer | Withdraw pending proposal |
| 6 | `mint` | Owner | Create tokens |
| 7 | `burn` | Owner | Destroy tokens |

## State

```
governors          pubkey[]    // N authorized parties
quorum             uint8       // M required
veto_power         bool        // single-party block?
proposal_timeout   uint64      // blocks before expiry
execution_delay    uint64      // blocks between quorum and execution
proposals: [{
  id                uint64
  proposer          pubkey
  recipient         pubkey
  amount            uint64
  reason_hash       bytes32
  approvals         pubkey[]
  vetoes            pubkey[]
  expires           uint64
}]
```

## Use Cases

- **DAO treasury**: 5 of 9 signers to deploy capital
- **Corporate account**: CEO proposes, CFO seconds, 48-hour delay
- **Escrow**: buyer, seller, arbitrator — 2 of 3 to release
- **Inheritance fund**: 3 of 5 heirs to access

## Encoding

For the technical encoding of transfer operations, state field ordering, witness semantics, and positional input/output pairing, see KCC-0020 (Fungible Token Covenant Specification by Manyfest, Michael Sutton, and IzioDev). This standard defines the interface; KCC-0020 defines the byte-level implementation.

## Rules

1. Governor set and quorum are immutable after deployment.
2. A governor may not approve their own proposal.
3. Execution fails if expired, below quorum, or vetoed.
4. `execution_delay` prevents last-minute approval — execution.
5. If governor set size falls below quorum, proposals cannot execute.