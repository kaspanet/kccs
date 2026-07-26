# KCC-0015: Vesting Token Standard

| Field | Value |
|-------|-------|
| **KCC** | 0015 |
| **Category** | Asset Standard |
| **Title** | Vesting Token — Time-Locked and Streaming Release |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |
| **Depends on** | KCC-0008 (PR #10, draft), KCC-0020 (PR #2, draft) |

## Abstract

A token whose transferability is time-gated by a vesting schedule. Tokens are issued immediately to a holder but remain locked until they unlock according to the schedule. Four schedule types are supported: cliff (single block unlock), linear (gradual vesting over a range), streaming (fixed-rate per-block release), and milestone (oracle-gated unlock via KCC-0011). Issuers may optionally retain clawback rights over unvested tokens. The standard builds on KCC-0020 for transfer semantics; only claimed tokens participate in the transfer covenant.

## Motivation

Equity grants, SAFT deliveries, team allocations, advisory retainers, and subscription services all share a common primitive: tokens assigned now, accessible later. Without a standard vesting covenant, each deployment encodes its own unlocking logic, divergent interpretations of "vested," and incompatible clawback mechanics. A single vesting standard means wallets display unlock progress uniformly, DEXes route only claimable balances, and auditors verify one schedule calculus instead of many.

## Specification

### State Layout

Every KCC-0015 covenant state begins with the following fields, in this order and encoding:

```
offset  size    field               encoding
0       1       schedule_type       uint8
1       1       flags               byte
2       32      issuer_id           bytes32
34      32      holder_id           bytes32
66      8       total_issued        uint64, big-endian
74      8       total_claimed       uint64, big-endian
82      8       issued_at_block     uint64, big-endian
90      32      schedule_params     bytes32
122     1       clawback_enabled    byte
123     23      reserved            zero-filled
```

Total: 147 bytes of covenant state.

**schedule_type** values:

```
CLIFF      = 0x00  // 0% until cliff_block, 100% after
LINEAR     = 0x01  // 0%→100% from start_block to end_block
STREAMING  = 0x02  // fixed rate_per_block, continuous
MILESTONE  = 0x03  // oracle-attested condition (KCC-0011)
```

**flags** bitfield:

```
BIT_REVOKED      = 0x01  // clawback executed; unvested tokens returned to issuer (terminal)
BIT_ACCELERATED  = 0x02  // full unlock triggered by issuer; all tokens immediately vested
```

**schedule_params** encoding per schedule type:

Schedule type determines how the 32-byte `schedule_params` field is interpreted. Unused bytes must be zero-filled.

```
CLIFF (0x00):
  bytes[0..7]   cliff_block       uint64, big-endian
  bytes[8..31]  zero-filled

LINEAR (0x01):
  bytes[0..7]   start_block       uint64, big-endian
  bytes[8..15]  end_block         uint64, big-endian
  bytes[16..31] zero-filled

STREAMING (0x02):
  bytes[0..7]   rate_per_block    uint64, big-endian  // in smallest token unit
  bytes[8..31]  zero-filled

MILESTONE (0x03):
  bytes[0..31]  condition_id      bytes32             // references KCC-0011 conditional token
```

**total_issued**: total tokens placed under the vesting schedule at issuance. Immutable after `issue`.

**total_claimed**: cumulative tokens already claimed by the holder. Incremented by `claim`.

**issued_at_block**: the block height at which `issue` was executed. Used as the baseline for STREAMING unlocked calculation.

**clawback_enabled**: `0x00` = clawback disabled, `0x01` = clawback enabled. Immutable after `issue`.

**holder_id**: identity of the vesting beneficiary. Immutable — vested rights cannot be transferred to another party before claim.

### Unlocked Amount Calculation

The unlocked amount for a vesting state at block height `H` is computed as follows:

**CLIFF** (`schedule_type == 0x00`):

```
unlocked(H) = H >= cliff_block ? total_issued : 0
```

**LINEAR** (`schedule_type == 0x01`):

```
              ┌ 0                            if H < start_block
unlocked(H) = ┤ total_issued                  if H >= end_block
              └ floor(total_issued * (H - start_block) / (end_block - start_block))   otherwise
```

**STREAMING** (`schedule_type == 0x02`):

```
elapsed = H - issued_at_block
unlocked(H) = min(total_issued, rate_per_block * elapsed)
```

**MILESTONE** (`schedule_type == 0x03`):

```
unlocked(H) = oracle_attested(condition_id) ? total_issued : 0
```

`oracle_attested(condition_id)` returns `true` when the KCC-0011 conditional token identified by `condition_id` has status `MET`.

The **claimable** amount at any block height is:

```
claimable(H) = unlocked(H) - total_claimed
```

### Core Entrypoints

#### issue

```
issue(
    byte      schedule_type,
    bytes32   schedule_params,   // encoded per schedule_type (see State Layout)
    uint64    total_issued,
    bytes32   holder_id,
    byte      clawback_enabled   // 0x00 or 0x01
)
```

Called by the issuer. Creates the vesting covenant UTXO. Rules:

1. `total_issued` must be > 0.
2. `schedule_params` must be valid for the given `schedule_type`:
   - CLIFF: `cliff_block` must be ≥ issuing block height.
   - LINEAR: `end_block` must be > `start_block`.
   - STREAMING: `rate_per_block` must be > 0.
   - MILESTONE: `condition_id` must reference an existing KCC-0011 conditional token in PENDING status whose `oracle_id` references an ACTIVE oracle operator per KCC-0018.
3. `holder_id` must not be the zero address.
4. On success, a covenant UTXO is produced with the state populated as specified: `total_claimed = 0`, `issued_at_block = current_block`, `flags = 0x00`. The issuer is recorded as `issuer_id`.

#### claim

```
claim()
```

Called by the holder. Converts unlocked tokens into a transferable UTXO governed by KCC-0020. Rules:

1. `BIT_REVOKED` must not be set.
2. `claimable = unlocked(current_block) - total_claimed`. If `claimable == 0`, the call fails.
3. On success:
   - A new KCC-0020-governed UTXO is produced with `amount = claimable` and `owner_id = holder_id`.
   - The vesting UTXO is updated: `total_claimed += claimable`.
   - If `total_claimed == total_issued`, the vesting UTXO may be pruned (all tokens claimed).

#### transfer

```
transfer(
    State[] newStates,     // successor states, ordered by covenant output index
    sig[] sigs,       // authorization signatures, positional
    byte[]  witnesses         // per-input metadata
)
```

Transfers **already-claimed** tokens. This entrypoint operates on the KCC-0020-governed UTXOs produced by `claim`, not on the vesting UTXO itself. Rules:

1. The vesting UTXO (containing `schedule_type`, `schedule_params`, etc.) is NOT an input to `transfer`.
2. Only claimed UTXOs — those produced by prior `claim` calls — may be transferred.
3. All KCC-0020 transfer rules apply (see KCC-0020 Alignment).

#### revoke

```
revoke()
```

Called by the issuer. Executes clawback of unvested tokens. Only available when `clawback_enabled == 0x01`. Rules:

1. Caller must be `issuer_id`.
2. `BIT_REVOKED` must not already be set.
3. `BIT_ACCELERATED` must not be set.
4. `unvested = total_issued - unlocked(current_block)`. If `unvested == 0`, the call fails (nothing to revoke).
5. On success:
   - A UTXO is produced returning `unvested` tokens to `issuer_id`. These tokens are **not** burned — they return to the issuer's control.
   - The vested portion (`total_issued - unvested`) remains with the holder. Any previously claimed tokens are unaffected.
   - `BIT_REVOKED` is set on the vesting UTXO. The vesting UTXO enters terminal state — no further `claim` calls are permitted, but previously claimed tokens remain transferable.

#### accelerate

```
accelerate()
```

Called by the issuer. Immediately vests all remaining unvested tokens. Rules:

1. Caller must be `issuer_id`.
2. `BIT_REVOKED` must not be set.
3. `BIT_ACCELERATED` must not already be set.
4. On success:
   - `BIT_ACCELERATED` is set. From this point, `unlocked(H) = total_issued` for all `H`.
   - The holder may claim the full remainder in a subsequent `claim` call.

### Milestone Oracle Integration

When `schedule_type == MILESTONE` (`0x03`), the `schedule_params` field contains a `condition_id` (bytes32) that references a KCC-0011 conditional token. The integration works as follows:

1. **At issuance**: the issuer must deploy or reference an existing KCC-0011 conditional token whose `oracle_id` is an ACTIVE operator per KCC-0018. The condition type is typically `ATTESTATION`, representing a deliverable, milestone, or external event.

2. **During vesting**: every `claim` call evaluates `oracle_attested(condition_id)`, which queries the KCC-0011 conditional token:
   - If KCC-0011 status is `PENDING`: unlocked = 0. `claim` fails if no prior claims exist.
   - If KCC-0011 status is `MET`: unlocked = `total_issued`. Holder may claim all remaining tokens.
   - If KCC-0011 status is `FAILED` or `EXPIRED`: unlocked = 0 permanently. The issuer should call `revoke` (if clawback is enabled) to recover the tokens.

3. **Atomicity**: the oracle check and `unlocked` computation occur within the same covenant execution. The holder does not need to call KCC-0011's `resolve` separately — the oracle attests the condition, and the vesting covenant reads the resolved status.

### Descriptor

Each KCC-0015 covenant deployment must publish a descriptor:

```
KCC0015Descriptor {
    prefix: bytes              // covenant script bytes before mutable state
    suffix: bytes              // covenant script bytes after mutable state
    schedule_type: uint8       // CLIFF | LINEAR | STREAMING | MILESTONE
    schedule_params: bytes32   // encoded per schedule_type
    total_issued: uint64       // total tokens under vesting
    clawback_enabled: bool     // whether issuer retains clawback rights
}
```

The descriptor allows wallets and indexers to identify the vesting covenant, decode its state, and compute unlocked amounts without executing the covenant script.

### KCC-0020 Alignment

This standard adopts the following from KCC-0020:

- **Transfer interface**: leader/delegator pattern with `transfer(State[], sig[], byte[])` entrypoint signature for claimed tokens
- **Positional input/output pairing**: consumed state at index `i` corresponds to successor state at index `i`
- **Witness semantics**: positional witness values determine authorization mode
- **Borrowed Receive**: `witnesses[i] == 0xFF` exempts input from owner authorization for claimed tokens

Where this standard extends KCC-0020:

- **Vesting state**: `schedule_type`, `schedule_params`, `total_issued`, `total_claimed`, `issued_at_block` — fields that do not exist in KCC-0020 but govern token availability
- **Unlocked calculation**: per-block computation of transferable amount from schedule parameters and current block height
- **Claim entrypoint**: bridge that converts vested-but-locked tokens into KCC-0020-transferable UTXOs
- **Clawback mechanics**: issuer-initiated revocation of unvested tokens with on-chain return to issuer
- **Acceleration**: issuer-initiated full vesting, overriding the schedule
- **Milestone integration**: oracle-gated vesting via KCC-0011 conditional token status

**Critical invariant**: vesting UTXOs in locked state are NOT transferable via KCC-0020. The `transfer` entrypoint operates exclusively on claimed UTXOs. The vesting UTXO itself can only be modified by `claim`, `revoke`, or `accelerate`. This separation ensures that no KCC-0020-compliant wallet or DEX can inadvertently move unvested tokens.

## Encoding

This standard specifies the semantic interface, state layout, and unlocking calculus for vesting tokens. For the byte-level encoding of the transfer leader/delegator pattern, witness positional semantics, and Borrowed Receive extension, see KCC-0020. For the conditional token and oracle attestation format consumed by MILESTONE schedules, see KCC-0011 (Conditional Token Standard) and KCC-0017 (Oracle Attestation Format). For oracle operator registration, see KCC-0018 (Oracle Registry).

The vesting covenant itself encodes the following at the byte level:
- State layout as defined in the State Layout section above (147 bytes, packed)
- `schedule_params` sub-encoding per `schedule_type` as defined in the schedule_params encoding table
- `unlocked(H)` computation formula as defined in the Unlocked Amount Calculation section

## Profiles

Wallets and DEXes detect vesting behavior from the covenant descriptor:

| Profile | Detection | Behavior |
|---------|-----------|----------|
| **Vesting UTXO** | `schedule_type` present, `total_claimed < unlocked(H)` | Display locked + unlocked breakdown; enable `claim` button |
| **Claimed UTXO** | Governed by KCC-0020, no vesting fields | Standard transfer; indistinguishable from regular KCC-0020 tokens |
| **Revoked** | `BIT_REVOKED` set | Display vested portion; no further claims possible; previously claimed tokens unaffected |
| **Accelerated** | `BIT_ACCELERATED` set | Display full balance as claimable; `unlocked(H) == total_issued` |

## Rules

1. `holder_id` is immutable after `issue` — vested rights are non-transferable.
2. `total_issued` is immutable after `issue` — no minting or burning of vested tokens.
3. `schedule_type` and `schedule_params` are immutable after `issue` — the vesting schedule cannot be modified.
4. `clawback_enabled` is immutable after `issue`.
5. `transfer` on a vesting UTXO (one containing `schedule_type`) must fail — only claimed tokens are transferable.
6. `claim` fails when `claimable(H) == 0` — the holder must wait for tokens to unlock.
7. `claim` fails when `BIT_REVOKED` is set — clawback terminates the vesting schedule.
8. `revoke` returns unvested tokens to `issuer_id` — tokens are returned, not burned.
9. `revoke` does not affect already-claimed tokens — claimed tokens remain in the holder's control.
10. `accelerate` sets `BIT_ACCELERATED` and makes `unlocked(H) = total_issued` for all future `H`.
11. MILESTONE schedules require the referenced `condition_id` to be a valid KCC-0011 conditional token with an ACTIVE oracle per KCC-0018 at issuance time.
12. STREAMING `rate_per_block` is expressed in the smallest token unit and is immutable after `issue`.
13. LINEAR schedules require `end_block > start_block`.
14. CLIFF schedules require `cliff_block` ≥ `issued_at_block`.
15. The descriptor must be published before any wallet or indexer can compute unlock progress.

## Reference

- **KCC-0020**: Fungible Token Covenant Specification — transfer encoding and witness semantics
- **KCC-0011**: Conditional Token Standard — oracle-gated condition for MILESTONE schedules
- **KCC-0017**: Oracle Attestation Format — binary format for oracle-signed data
- **KCC-0018**: Oracle Registry — operator registration and verification

The author maintains a conforming implementation. This document defines the convention; an implementation demonstrates conformance.