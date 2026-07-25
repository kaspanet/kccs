# KCC-0018: Oracle Registry Covenant Convention

| Field | Value |
|-------|-------|
| **KCC** | 0018 |
| **Category** | Covenant Convention |
| **Title** | Oracle Registry — Operator Lifecycle and Attestation Verification |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |
| **Updated** | 2026-07-25 |

## Abstract

A covenant convention for a decentralized oracle operator registry on Kaspa. This convention defines the operator lifecycle (apply, approve, activate, suspend, reinstate, revoke, exit), bond requirements, key management, heartbeat monitoring, and operator verification. Commerce contracts and conditional tokens verify attestation signers against the registry — only registered, bonded, and ACTIVE operators may produce valid attestations. This is the trust anchor for the oracle ecosystem.

## Motivation

Conditional tokens (KCC-0011), RWA tokens (KCC-0013), ISDA derivatives (KCC-0022), lending contracts (KCC-0023), and trade finance instruments (KCC-0024) all depend on oracle attestations. Each must answer one question: "Is this attestation from a legitimate operator?" Without a standard registry convention, every contract implements its own operator verification — incompatible, unauditable, and prone to error.

A single registry convention means one operator list, one verification interface, and one bond economy. Operators bond once and serve every contract. Contracts verify once and trust every compliant operator.

## Specification

### State Layout

The Oracle Registry covenant maintains an operator directory as covenant state. Each registered operator has one entry:

```
offset  size    field               encoding
0       32      operator_id         bytes32 (x-coordinate of SECP256k1 compressed pubkey)
32      32      backup_pubkey       bytes32 (optional backup, zero if unset)
64      8       bond_amount         uint64, big-endian (in sompi)
72      8       applied_at          uint64, big-endian (block height)
80      8       approved_at         uint64, big-endian (block height, 0 if pending)
88      8       last_heartbeat      uint64, big-endian (block height)
96      8       total_attestations  uint64, big-endian (lifetime count)
104     8       dispute_count       uint64, big-endian
112     1       status              byte
113     1       flags               byte
114     14      reserved            zero-filled
```

Total: 128 bytes per operator.

**status** values:

```
APPLIED    = 0x00  // application submitted, bond locked, awaiting approval
APPROVED   = 0x01  // admin has issued key pair, awaiting activation
ACTIVE     = 0x02  // operator is live and producing attestations
SUSPENDED  = 0x03  // temporarily paused (investigation, maintenance)
REVOKED    = 0x04  // permanently removed, bond slashed (terminal)
REJECTED   = 0x05  // application denied, bond returned (terminal)
CLOSED     = 0x06  // voluntary exit, bond returned minus penalty (terminal)
```

**flags** bitfield:

```
BIT_DIVERSITY_CHECKED = 0x01  // admin has verified operator is not a copycat
```

### Registry Parameters

The registry deployment stores covenant-global parameters:

```
offset  size    field                   encoding
0       8       min_bond                uint64, big-endian (in sompi)
8       8       attestation_expiry      uint64, big-endian (blocks)
16      8       heartbeat_timeout       uint64, big-endian (blocks without heartbeat → auto-suspend)
24      8       price_floor             uint64, big-endian (minimum attestation price in sompi)
32      2       diversity_threshold     uint16, big-endian (bips, 9999 = 0.9999 correlation)
34      2       outlier_threshold       uint16, big-endian (bips, 200 = 2% deviation from median)
36      1       admin_count             byte
37      256     admin_ids              bytes32[8] (up to 8 administrator operator_ids)
```

Total: 325 bytes of registry parameters.

Recommended defaults:
- `min_bond`: 30,000 KAS (3,000,000,000,000 sompi)
- `attestation_expiry`: 10 blocks (~10 seconds)
- `heartbeat_timeout`: 600 blocks (~10 minutes)
- `price_floor`: 500 KAS/month equivalent per subscriber
- `diversity_threshold`: 9999 bips (0.9999 correlation — nearly identical price feeds trigger review)
- `outlier_threshold`: 200 bips (2% deviation from median flags operator)

### Entrypoints

#### apply

```
apply(
    bytes32 operator_id,    // SECP256k1 compressed public key
    uint64  bond_amount         // in sompi, must be ≥ min_bond
)
```

Submits an operator application with bond. Callable by anyone. Rules:

1. `operator_id` must not already exist in the registry with status APPLIED, APPROVED, ACTIVE, or SUSPENDED.
2. `bond_amount` must be ≥ `min_bond` and must be a finite integer.
3. The bond is locked in the registry covenant — the applicant transfers `bond_amount` sompi to the registry as part of the transaction.
4. On success, a new operator entry is created: `status = APPLIED`, `applied_at = current_block`, `bond_amount` recorded. All other fields zeroed.

#### approve

```
approve(
    bytes32 operator_id
)
```

Admin approves an application. Caller must be an admin (operator_id in `admin_ids`). Rules:

1. Operator must exist with `status == APPLIED`.
2. `BIT_DIVERSITY_CHECKED` must be set (admin must run diversity check before approving).
3. On success: `status = APPROVED`, `approved_at = current_block`.

#### activate

```
activate(
    bytes32 operator_id
)
```

Admin activates an approved operator. Caller must be an admin. Rules:

1. Operator must exist with `status == APPROVED`.
2. On success: `status = ACTIVE`, `last_heartbeat = current_block`.

#### suspend

```
suspend(
    bytes32 operator_id
)
```

Admin suspends an operator. Caller must be an admin. Rules:

1. Operator must exist with `status == ACTIVE`.
2. On success: `status = SUSPENDED`. The operator cannot produce valid attestations while suspended.

#### reinstate

```
reinstate(
    bytes32 operator_id
)
```

Admin reinstates a suspended operator. Caller must be an admin. Rules:

1. Operator must exist with `status == SUSPENDED`.
2. On success: `status = ACTIVE`, `last_heartbeat = current_block`.

#### revoke

```
revoke(
    bytes32 operator_id
)
```

Admin permanently revokes an operator. Caller must be an admin. Rules:

1. Operator must exist with `status == ACTIVE` or `status == SUSPENDED`.
2. On success: `status = REVOKED`. The operator's bond is slashed (retained by the registry). Terminal — no further transitions.

#### reject

```
reject(
    bytes32 operator_id
)
```

Admin rejects an application. Caller must be an admin. Rules:

1. Operator must exist with `status == APPLIED`.
2. On success: `status = REJECTED`. The bond is returned to the applicant's original funding address. Terminal.

#### exit

```
exit(
    bytes32 operator_id
)
```

Operator voluntarily exits. Caller must be the operator (signature matching `operator_id`) AND an admin must co-sign. Rules:

1. Operator must exist with `status == ACTIVE`.
2. Both operator signature and admin signature are required.
3. On success: `status = CLOSED`. Bond returned minus exit penalty (1% of bond). Terminal.

#### heartbeat

```
heartbeat(
    bytes32 operator_id
)
```

Operator proves liveness. Caller must be the operator (signature matching `operator_id`). Rules:

1. Operator must exist with `status == ACTIVE`.
2. On success: `last_heartbeat = current_block`.

Auto-suspension: if `current_block - last_heartbeat > heartbeat_timeout` when any entrypoint reads the operator's state, the operator is treated as SUSPENDED. The actual status transition happens lazily — on the next admin action or on the next attestation verification that reads this operator.

#### set_backup

```
set_backup(
    bytes32 backup_pubkey     // SECP256k1 compressed, zero to clear
)
```

Operator sets a backup key. Caller must be the operator. Rules:

1. Operator must exist with `status == ACTIVE`.
2. On success: `backup_pubkey` is set. The backup key can sign attestations if the primary key is compromised, but only the primary key can call `set_backup` or `exit`.

#### verify_diversity

```
verify_diversity(
    bytes32 operator_id
)
```

Admin marks an operator as diversity-checked. Caller must be an admin. Rules:

1. Operator must exist with `status == APPLIED`.
2. On success: `BIT_DIVERSITY_CHECKED` is set.

Diversity verification is performed off-chain (correlation analysis against existing operators' price feeds) and recorded on-chain via this entrypoint. A diversity check failure means the applicant's price feed is too similar to an existing operator (likely copycat — same data source, same infrastructure).

#### set_price_floor

```
set_price_floor(
    uint64 new_price_floor     // in sompi
)
```

Admin updates the minimum attestation price. Caller must be an admin. Rules:

1. On success: `price_floor = new_price_floor`.

### Descriptor

Each Oracle Registry deployment must publish a descriptor:

```
OracleRegistryDescriptor {
    prefix: bytes                   // covenant script bytes before mutable state
    suffix: bytes                   // covenant script bytes after mutable state
    operator_count: uint64          // current number of registered operators
    min_bond: uint64                // minimum bond in sompi
    attestation_expiry: uint64      // max attestation age in blocks
    operator_entry_size: uint64     // 128 bytes per operator entry
    admin_ids_hash: bytes32         // blake2b of packed admin_ids[]
}
```

### Operator Verification Interface

Contracts verify operators by reading the registry state. The verification is a state read, not a cross-covenant call:

1. **Locate the operator UTXO**: the verifying contract identifies the operator's UTXO in the registry by `operator_id`. This is the same 32-byte x-coordinate that appears in KCC-0017 attestations. The operator UTXO's covenant address is derived from the registry covenant template + the operator_id as the state discriminator — each operator occupies a known UTXO slot indexed by operator_id.
2. **Read operator state**: consume or reference the operator's UTXO. Parse the 128-byte entry using the layout above.
3. **Check status**: `status == ACTIVE`.
4. **Check heartbeat**: `current_block - last_heartbeat ≤ heartbeat_timeout`.
5. **Check bond**: `bond_amount ≥ min_bond`.
6. **Verify attestation signature**: the attestation's `operator_id` (KCC-0017, bytes 73–104) must match the registry entry's `operator_id`. Recover the full SECP256k1 public key from the attestation signature and verify its x-coordinate matches.

If all checks pass, the attestation is valid. The verifying contract may cache the operator's status for the duration of the transaction.

### KCC-0020 Alignment

This convention does **not** implement the KCC-0020 transfer interface. It is a registry, not a token.

| Feature | KCC-0020 | KCC-0018 |
|---------|:---:|:---:|
| Transfer leader/delegator | ✓ | ✗ |
| Standard transfer | ✓ | ✗ |
| Borrowed Receive | ✓ | ✗ |
| Descriptor prefix/suffix | ✓ | ✓ |
| Offset-based state layout | ✓ | ✓ |
| Big-endian encoding | ✓ | ✓ |
| Blake2b extended state digest | ✓ | ✓ |
| Operator lifecycle management | ✗ | ✓ |
| Bond/slash economics | ✗ | ✓ |
| Admin-governed state machine | ✗ | ✓ |

### Composability

OracleRegistry composes with:

- **KCC-0011** (Conditional Token): `resolve()` verifies attestation signer is ACTIVE in the registry before accepting condition fulfillment.
- **KCC-0013** (RWA Token): `verify_asset()` checks that NAV attestation comes from an ACTIVE oracle with sufficient bond.
- **KCC-0017** (Oracle Attestation Format): attestations carry `operator_id` which matches `operator_id` in the registry.
- **KCC-0022** (ISDA Derivatives): rate fixing data (SOFR, EURIBOR) verified against registry operators.
- **KCC-0023** (Lending): interest rate reference data verified against registry operators.
- **ConsensusSignal** (KCC-0019): condition_met/condition_failed oracle attestations verified against registry.

## Rules

1. Only ACTIVE operators may sign attestations. APPLIED, APPROVED, SUSPENDED, REVOKED, REJECTED, and CLOSED operators cannot produce valid attestations.
2. Attestations must be signed with the operator's SECP256k1 key. The `operator_id` stored in the registry is the 32-byte x-coordinate of the compressed public key (prefix byte 0x02/0x03 dropped). KCC-0017 attestations carry the same 32-byte `operator_id`. Signature verification recovers the full 33-byte key and checks that the x-coordinate matches.
3. Verifying contracts must check that the attestation signer's registry status is ACTIVE and heartbeat is current.
4. Administrators must run diversity checks (off-chain) before approving new operators and record the result via `verify_diversity`.
5. Operators must heartbeat within `heartbeat_timeout` blocks. Operators that miss the heartbeat window are treated as SUSPENDED by any contract reading their state.
6. `revoke` permanently slashes the operator's bond. The bond is retained by the registry.
7. `exit` returns the bond minus a 1% penalty. Both operator and admin signatures are required.
8. `min_bond` and `price_floor` are adjustable by admin. All other registry parameters are immutable after deployment.
9. Bond amounts use sompi (1 KAS = 100,000,000 sompi). All bond validation must reject non-finite or negative values.
10. The descriptor must be published before any contract can reference the registry for operator verification.

## Reference

The author maintains a conforming implementation. This document defines the convention; an implementation demonstrates conformance.

Companion standards:

- **KCC-0001**: Covenant ownership and authorization model (IzioDev).
- **KCC-0011**: Conditional Token Standard — consumes oracle attestations verified against this registry.
- **KCC-0017**: Oracle Attestation Format — binary attestation structure with operator_id matching operator_id.
- **KCC-0019**: Legal Signaling — ConsensusSignal for condition_met/condition_failed oracle events.
