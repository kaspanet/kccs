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

A token whose transferability is gated on an oracle-attested condition. Each conditional token embeds a condition type, its encoded parameters, a reference to an oracle operator, and a resolution deadline. Tokens are locked until an oracle attests that the condition has been met. Once met, transfers unlock and the token behaves as a standard KCC-0008 fungible or non-fungible token. If the deadline passes with the condition still pending or if the oracle attests failure, tokens revert to a designated recipient.

This standard builds on KCC-0008 (Multi-Token Standard) for its state layout and transfer semantics, and integrates with KCC-0017 (Oracle Attestation Format) and KCC-0018 (Oracle Registry) for condition resolution.

## Motivation

Several real-world instruments require tokens whose delivery is contingent on external events:

- **SAFT delivery**: tokens unlock when a network launch is attested by a designated oracle.
- **Performance bonus**: tokens vest when a price target is met (e.g., KAS exceeds a threshold).
- **Milestone escrow**: payment is released on delivery confirmation attested by an agreed-upon oracle.
- **Prediction market settlement**: claim payout on an oracle-reported outcome.

Without a standard for conditional tokens, every such contract uses ad-hoc locking logic, making wallets, indexers, and DEXes unable to recognize or interact with the token before resolution. A single standard means tooling integrates once — conditional tokens appear in wallets with their condition displayed, resolution status tracked, and transfers enabled automatically when conditions are met.

## Specification

### State Layout

Every KCC-0011 covenant state begins with the KCC-0008 standard header (147 bytes), followed by the conditional token extended state (154 bytes). Total: 301 bytes.

#### KCC-0008 Standard Header

```
offset  size    field           encoding
0       8       token_id        uint64, big-endian
8       1       token_kind      byte
9       1       flags           byte
10      32      owner_id        bytes32
42      8       amount          uint64, big-endian
50      64      metadata_uri    padded bytes64, UTF-8
114     32      extended_state_digest bytes32
```

The `extended_state_digest` field commits to the conditional token extended state below. It is computed as:

```
extended_state_digest = blake2b(encode(extended_state))
```

where `extended_state` is the 106-byte conditional token payload described next.

#### Conditional Token Extended State

```
offset  size    field               encoding
0       1       condition_type      uint8
1       32      condition_params    bytes32 (type-specific encoding)
33      32      oracle_operator_id  bytes32 (SECP256k1 compressed pubkey, 33 bytes)
65      8       deadline            uint64, big-endian (block height)
73      32      revert_recipient    bytes32 (owner_id)
105     1       status              uint8
106     32      oracle_registry_id  bytes32 (covenant ID of KCC-0018 Oracle Registry)
138     8       max_attestation_age uint64, big-endian (max blocks attestation is valid)
146     8       last_resolve_nonce  uint64, big-endian (prevents replay)
```

Total: 154 bytes.

**condition_type** values:

```
PRICE_ABOVE   = 0x00  // price > threshold
PRICE_BELOW   = 0x01  // price < threshold
BLOCK_REACHED = 0x02  // specified block height reached
ATTESTATION   = 0x03  // arbitrary condition hash attested
```

**status** values:

```
PENDING = 0x00  // condition not yet evaluated
MET     = 0x01  // condition satisfied; transfers enabled
FAILED  = 0x02  // condition unsatisfied; revert only
EXPIRED = 0x03  // deadline passed with status PENDING; revert only
```

#### condition_params Encoding

The `condition_params` field is a fixed 32-byte value whose internal encoding depends on `condition_type`. All multi-byte integers are big-endian. Unused bytes are zero-padded.

##### PRICE_ABOVE / PRICE_BELOW (0x00 / 0x01)

```
offset  size    field               encoding
0       16      pair_hash           bytes16 — blake2b(pair_string)[0:16]
16      8       threshold           uint64, big-endian
24      1       threshold_decimals   uint8
25      7       (reserved)          zero-padded
```

The `pair_hash` is the first 16 bytes of `blake2b(pair_string)` where `pair_string` is the ASCII trading pair (e.g., `"KAS/USD"`). The `threshold` is the price threshold as an integer after scaling by `10^threshold_decimals`. For example, to encode "KAS/USD > 0.10":

```
pair_hash        = blake2b("KAS/USD")[0:16]
threshold        = 10
threshold_decimals = 2
// Represents 10 / 10^2 = 0.10
```

The condition evaluates as `price_numerator / price_denominator > threshold / 10^threshold_decimals` (for PRICE_ABOVE) or `<` (for PRICE_BELOW), using the rational price from the KCC-0017 attestation.

##### BLOCK_REACHED (0x02)

```
offset  size    field               encoding
0       8       block               uint64, big-endian — target block height
8       24      (reserved)          zero-padded
```

The condition evaluates as `attestation.block_height >= block`.

##### ATTESTATION (0x03)

```
offset  size    field               encoding
0       32      condition_hash      bytes32 — blake2b hash of the attested condition
```

The condition evaluates by comparing `condition_hash` against a hash derived from the attestation content. The oracle signs an attestation that includes the `condition_hash` in an attested payload, confirming the condition has been met.

### Core Entrypoints

#### mint

```
mint(
    uint64  token_id,
    byte    token_kind,
    uint64  amount,
    bytes64 metadata_uri,
    uint8   condition_type,
    bytes32 condition_params,
    bytes32 oracle_operator_id,
    uint64  deadline,
    bytes32 revert_recipient
)
```

Creates a conditional token. Caller must be the covenant owner (see KCC-0001 for owner identification). Rules:

1. `token_id` must not already exist in the covenant state.
2. If `token_kind == NON_FUNGIBLE` (0x01): `amount` must equal 1.
3. `condition_type` must be a valid enum value (0x00–0x03).
4. `condition_params` must be a valid encoding for the given `condition_type`.
5. `oracle_operator_id` must reference a registered oracle operator (see KCC-0018).
6. `deadline` must be > current block height.
7. `revert_recipient` must be a valid owner_id.
8. On success, a new UTXO is produced with the KCC-0008 standard header plus the conditional extended state, `status = PENDING` (0x00), `flags = BIT_MINTED`, and the covenant owner as initial `owner_id`.

#### mint_batch

```
mint_batch(
    ConditionalMintParams[] tokens
)
```

Atomic batch mint of conditional tokens. Each `ConditionalMintParams` is:

```
{
    uint64  token_id,
    byte    token_kind,
    uint64  amount,
    bytes64 metadata_uri,
    uint8   condition_type,
    bytes32 condition_params,
    bytes32 oracle_operator_id,
    uint64  deadline,
    bytes32 revert_recipient
}
```

All tokens are created or none are. Same rules as `mint` apply per token.

#### transfer

```
transfer(
    State[] next_states,
    Sig[]   signatures,
    byte[]  witnesses
)
```

`transfer` is invoked by the first covenant input as the leader entrypoint. It validates the complete state transition for one or more `token_id` values. Remaining covenant inputs invoke `transfer_delegator` (no input data) to join the transfer declared by the leader.

Rules enforced (in addition to all KCC-0008 transfer rules):

1. For each consumed state: `status` must be `MET` (0x01). Transfers are blocked while status is `PENDING`, `FAILED`, or `EXPIRED`.
2. All KCC-0008 rules apply: input/output sum preservation, `token_id` and `token_kind` immutability, non-fungible `amount == 1`, signature authorization, no frozen or burned states.
3. For the Borrowed Receive extension (`witnesses[i] == 0xFF`), see KCC-0020 Section "KCC20 Borrowed Receive Extension v1".

#### transfer_delegator

```
transfer_delegator()
```

Invoked by every non-leader covenant input. Delegates to the leader's `transfer` entrypoint. Enforces that at least one input invoked `transfer` as leader. Same semantics as KCC-0008/KCC-0020.

#### resolve

```
resolve(
    bytes attestation_blob
)
```

Evaluates the condition using an oracle attestation. Callable by anyone who can provide a valid attestation. The attestation must conform to KCC-0017 format.

**Attestation Verification Flow:**

1. **Parse attestation blob**: Extract version, pair, price_numerator, price_denominator, timestamp, block_height, nonce, operator_id, and signature per KCC-0017 layout.

2. **Format validation**: Verify `version == 0x01` and total length == 169 bytes (KCC-0017 §Verification rule 1).

3. **Operator match**: Verify `operator_id == oracle_operator_id` from the covenant's extended state. Only the designated operator may resolve this condition.

4. **Signature verification**: Recover the public key from the SECP256k1 `signature` over bytes 0–96 of the attestation blob. Verify the recovered key matches `operator_id` (KCC-0017 §Verification rule 4).

5. **Freshness check**: Verify `block_height >= current_block_height - max_attestation_age` where `max_attestation_age` is a covenant-level parameter (default: 10 blocks, per KCC-0018 §attestation_expiry).

6. **Nonce enforcement**: If a prior attestation was consumed by this covenant for this `token_id`, verify `nonce > previous_nonce` to prevent replay.

7. **Operator registry verification**: Verify `operator_id` is ACTIVE in the Oracle Registry covenant (per KCC-0018 §Convention Rules rule 1). The registry covenant ID is a deployment parameter.

8. **Condition evaluation**: Dispatch on `condition_type`:

   **PRICE_ABOVE (0x00):**
   - Compute `pair_hash = blake2b(attestation.pair)[0:16]` and verify it matches `condition_params.pair_hash`.
   - Compute `threshold_scaled = condition_params.threshold * (10 ^ condition_params.threshold_decimals)`.
   - Compute `attested_price_scaled = attestation.price_numerator * (10 ^ condition_params.threshold_decimals)`.
   - Condition is MET if `attested_price_scaled > condition_params.threshold * attestation.price_denominator`.
   - Set `status = MET` on success, `status = FAILED` otherwise.

   **PRICE_BELOW (0x01):**
   - Same pair_hash and scaling as PRICE_ABOVE.
   - Condition is MET if `attested_price_scaled < condition_params.threshold * attestation.price_denominator`.
   - Set `status = MET` on success, `status = FAILED` otherwise.

   **BLOCK_REACHED (0x02):**
   - Condition is MET if `attestation.block_height >= condition_params.block`.
   - Set `status = MET` on success, `status = FAILED` otherwise.

   **ATTESTATION (0x03):**
   - Compute `attested_hash` from the attestation payload (or a designated extension field).
   - Condition is MET if `attested_hash == condition_params.condition_hash`.
   - Set `status = MET` on success, `status = FAILED` otherwise.

9. On successful resolution (`status = MET` or `status = FAILED`), the state is updated. If resolution produced `status = MET`, the token becomes transferable.

#### revert

```
revert()
```

Returns tokens to the designated `revert_recipient`. Rules:

1. Must not be called while `status == MET`.
2. If `status == PENDING` and `current_block_height > deadline`: status transitions to `EXPIRED`, then revert proceeds.
3. If `status == FAILED` or `status == EXPIRED`: revert proceeds immediately.
4. On revert, a new UTXO is produced with `owner_id = revert_recipient`, preserving `token_id`, `token_kind`, `amount`, `metadata_uri`, and all conditional extended state fields. The new state retains `status` for auditability.

#### check_and_transfer

```
check_and_transfer(
    bytes   attestation_blob,
    State[] next_states,
    Sig[]   signatures,
    byte[]  witnesses
)
```

Atomic resolve + transfer in a single entrypoint. Combines the logic of `resolve` and `transfer`:

1. Execute `resolve(attestation_blob)` — evaluate and update status.
2. If status is now `MET`, execute `transfer(next_states, signatures, witnesses)`.
3. If status is `FAILED`, the entire call reverts — no state changes occur.
4. This ensures the oracle check and transfer are atomic within one covenant input.

This entrypoint is the preferred path for conditional token delivery because it eliminates the race between resolution and transfer.

### Atomic Oracle Check + Transfer

Conditional tokens achieve atomicity between condition resolution and transfer through two mechanisms:

**Mechanism 1: `check_and_transfer` entrypoint.** A single covenant input invokes `check_and_transfer`, which resolves the condition and — if met — transfers the token in one atomic step. No external coordination is needed.

**Mechanism 2: Multi-input transaction.** The `resolve` entrypoint is called on one covenant input while `transfer` is called on another covenant input in the same transaction. Because all covenant inputs in a Kaspa transaction execute atomically, the resolve sets `status = MET` and the transfer succeeds, or the resolve fails and the entire transaction is rejected. This mechanism supports scenarios where the attestation is provided separately from the transfer instruction.

### Descriptor

Each KCC-0011 covenant must publish a descriptor:

```
KCC0011Descriptor {
    prefix: bytes                      // covenant script bytes before mutable state
    suffix: bytes                      // covenant script bytes after mutable state
    token_ids: uint64[]                // conditional token_ids managed by this deployment
    condition_types: uint8[]           // condition_type per token_id, in same order
    oracle_operator_id: bytes32        // designated oracle operator
    max_attestation_age: uint64        // max blocks between attestation and resolution
    oracle_registry_id: bytes32        // covenant ID of the Oracle Registry (KCC-0018)
    kcc20_extensions: ExtensionId[]    // supported extensions (e.g., Borrowed Receive)
}
```

The descriptor allows wallets and indexers to identify the covenant, decode its state, display condition information to holders, and track resolution status.

### Witness Semantics

Witness values for the `transfer` and `check_and_transfer` entrypoints:

```
BORROWED_RECEIVE  = 0xFF   // KCC-0020 Borrowed Receive
STANDARD_TRANSFER = 0x00   // normal signed transfer
```

For `resolve`, witnesses are not used. For `mint`, `revert`, and caller-authorized entrypoints, witnesses correspond to standard authorization — the caller provides `signatures[i]` authorizing the state transition.

### KCC-0020 Alignment

This standard adopts the following from KCC-0020:

- **Transfer interface**: leader/delegator pattern with `transfer(State[], Sig[], byte[])` entrypoint signature
- **Positional input/output pairing**: consumed state at index `i` corresponds to successor state at index `i`
- **Witness semantics**: positional witness values determine authorization mode
- **Borrowed Receive**: `witnesses[i] == 0xFF` exempts input from owner authorization while preserving `owner_id`, `token_kind`, `extended_state_digest`
- **Extended state**: opaque `extended_state_digest` commitment via blake2b over the conditional token extended state
- **Descriptor**: `prefix/suffix` covenant script bytes for template identification

Where this standard extends KCC-0020:

- **Conditional gating**: `transfer` requires `status == MET` before allowing any transfer
- **Oracle attestation verification**: `resolve` and `check_and_transfer` parse and verify KCC-0017 attestations within the covenant
- **Condition type dispatch**: `condition_type` enum drives parameter parsing and evaluation logic
- **Deadline enforcement**: `deadline` block height gates the `revert` entrypoint
- **Revert logic**: `revert` redirects tokens to `revert_recipient` when the condition fails or expires
- **Atomic check-and-transfer**: `check_and_transfer` combines resolution and transfer in one entrypoint

## Encoding

This standard specifies the semantic interface, extended state layout, and oracle integration for conditional token covenants.

For the byte-level encoding of the transfer leader/delegator pattern, witness positional semantics, and Borrowed Receive extension, see KCC-0020.

For the binary attestation format consumed by the `resolve` entrypoint, including field layout, price encoding (rational numerator/denominator), and signature verification, see KCC-0017 (Oracle Attestation Format).

For operator registration, lifecycle states (ACTIVE/SUSPENDED/REVOKED), and the registry covenant verification step within `resolve`, see KCC-0018 (Oracle Registry Covenant Convention).

For the base token state layout (`token_id`, `token_kind`, `flags`, `owner_id`, `amount`, `metadata_uri`, `extended_state_digest`), standard transfer rules, mint/burn entrypoints, and the allowance system, see KCC-0008 (Multi-Token Standard).

For metadata identity and discovery, see KCC-0021.

For covenant owner identification, see KCC-0001.

What this standard defines:

- **Condition type enumeration**: `PRICE_ABOVE`, `PRICE_BELOW`, `BLOCK_REACHED`, `ATTESTATION`
- **condition_params encoding**: type-specific layouts within bytes32, including pair_hash derivation, threshold scaling with decimal places, and condition_hash matching
- **Oracle integration**: attestation parsing, signature verification, operator matching, registry verification, and condition evaluation within the covenant
- **Status machine**: `PENDING → MET | FAILED → (EXPIRED)` with transfer gating and revert semantics
- **Atomic resolution**: `check_and_transfer` combining oracle verification and transfer in one covenant input

## Rules

1. `token_id` must be unique and immutable within a deployment.
2. `condition_type` is immutable after minting for a given `token_id`.
3. `condition_params` encoding must be valid for the declared `condition_type`.
4. `oracle_operator_id` must reference an ACTIVE operator in the Oracle Registry (KCC-0018).
5. `deadline` must be strictly greater than the block height at mint time.
6. `revert_recipient` must be a valid owner_id.
7. `transfer` fails if `status ≠ MET`.
8. `resolve` fails if the attestation signature is invalid, the operator_id does not match, the operator is not ACTIVE in the registry, the attestation freshness exceeds `max_attestation_age`, or the nonce is not strictly greater than any prior nonce for this `token_id`.
9. `resolve` fails if `status ≠ PENDING` — conditions may be evaluated only once.
10. `revert` fails if `status == MET`.
11. `revert` succeeds if `status == PENDING` and `current_block_height > deadline`, transitioning `status` to `EXPIRED` before processing the revert.
12. `revert` succeeds if `status == FAILED` or `status == EXPIRED`.
13. `check_and_transfer` is atomic: if resolution produces `FAILED`, the transfer does not execute and all state changes are rolled back.
14. All KCC-0008 transfer rules apply to `transfer`, `transfer_delegator`, and `check_and_transfer` when the condition is met.
15. `mint` fails if any parameter is invalid per the rules above.
16. The descriptor must be published before any wallet or indexer can interact with the covenant.

## Reference

- **KCC-0001**: Covenant Owner Identification
- **KCC-0008**: Multi-Token Standard — base state layout and transfer semantics
- **KCC-0017**: Oracle Attestation Format — binary attestation structure consumed by `resolve`
- **KCC-0018**: Oracle Registry Covenant Convention — operator lifecycle and verification
- **KCC-0020**: Fungible Token Covenant Specification — transfer leader/delegator pattern, Borrowed Receive, witness semantics
- **KCC-0021**: Token Metadata Standard

The author maintains a conforming implementation. This document defines the convention; an implementation demonstrates conformance.