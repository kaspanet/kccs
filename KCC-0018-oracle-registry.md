# KCC-0018: Oracle Registry Covenant Convention

| Field | Value |
|-------|-------|
| **KCC** | 0018 |
| **Category** | Covenant Convention |
| **Title** | Oracle Registry — operator lifecycle and attestation verification |
| **Author** | Vida Wallet |
| **Status** | Draft (internal) |
| **Created** | 2026-07-24 |

## Abstract

This convention defines the standard covenant structure for a decentralized oracle operator registry on Kaspa. It specifies the operator lifecycle (apply, approve, activate, suspend, revoke), bond requirements, key distribution, diversity verification, and price floor enforcement.

## Motivation

Decentralized applications require tamper-proof price data. An oracle registry provides the trust layer: only registered, bonded, and active operators may sign attestations. Commerce contracts verify attestation signatures against the registry. Without a standard registry convention, every oracle implementation is incompatible with every commerce contract.

## Specification

### Covenant Structure

The OracleRegistry covenant has 12 entrypoints:

| Entrypoint | Access | State Transition | Description |
|-----------|--------|-----------------|-------------|
| `apply` | Any | ∅ → APPLIED | New operator applies with bond ≥ MIN_BOND |
| `approve` | Admin | APPLIED → APPROVED | Admin issues SECP256k1 key pair |
| `activate` | Admin | APPROVED → ACTIVE | Operator goes live, begins attesting |
| `suspend` | Admin | ACTIVE → SUSPENDED | Operator paused (investigation, maintenance) |
| `reinstate` | Admin | SUSPENDED → ACTIVE | Operator restored after suspension |
| `revoke` | Admin | ACTIVE/SUSPENDED → REVOKED | Operator permanently removed, bond slashed |
| `reject` | Admin | APPLIED → REJECTED | Application denied |
| `verify_diversity` | Admin | — | Checks operator isn't a copycat |
| `set_price_floor` | Admin | — | Sets minimum attestation price |
| `heartbeat` | Operator | — | Proves operator is alive and reporting |
| `set_backup` | Operator | — | Designates a backup operator |
| `exit` | Operator + Admin | ACTIVE → CLOSED | Voluntary exit, bond returned minus penalty |

### Key Parameters

| Parameter | Type | Description | Recommended |
|-----------|------|-------------|-------------|
| `min_bond` | uint64 | Minimum bond in sompi | 30,000 KAS (3,000,000,000,000 sompi) |
| `key_algorithm` | enum | Signing algorithm | SECP256k1 |
| `diversity_threshold` | uint16 | Bips (10000 = 1.0) for copycat correlation threshold | 9999 |
| `outlier_threshold` | uint16 | Bips (10000 = 1.0) for deviation from median | 200 |
| `attestation_expiry` | uint32 | Max age of attestation in blocks | 10 |

### Convention Rules

1. Only ACTIVE operators may sign attestations.
2. Attestations MUST be signed with the operator's SECP256k1 key.
3. Commerce contracts MUST verify the attestation signer is ACTIVE in the registry.
4. Oracle administrators MUST run diversity checks before approving new operators.
5. Operators MUST heartbeat within attestation_expiry blocks or be auto-suspended.

### Composability

OracleRegistry composes with:
- **ConsensusSignal** — for condition_met/condition_failed oracle attestations
- **CommerceEscrow** — escrow release gated on oracle price verification
- **ISDAConfirmation** — rate fixing and payment calculation via oracle data
- **SAFT** — milestone verification (network launch, token price)

### Implementation Notes

- Bond amounts are in sompi (1 KAS = 100,000,000 sompi).
- NaN/Inf values in bond amount MUST be rejected with `math.isfinite()` guard.
- Nonce monotonicity MUST be enforced via persistent counter.
- Circuit breaker state MUST persist across restarts.