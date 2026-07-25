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

A fungible token that deducts a configurable fee from every transfer and routes it to designated recipients via dedicated UTXOs. Fees are enforced at the covenant level — no off-chain accounting, no missed payments, no trusted relay. This standard extends KCC-0008 (Multi-Token Standard) with a fee schedule embedded in the extended state, delivering automatic revenue sharing on every transfer.

## Motivation

Creator royalties, platform fees, affiliate commissions, and charitable donations all share a common failure mode on existing blockchains: the enforcement lives outside the token. ERC-2981 defines a royalty interface that marketplaces may or may not honor. Platform fees require a trusted intermediary. Affiliate commissions rely on off-chain settlement. In every case, the payer can route around the fee.

A fee-on-transfer token embeds the fee schedule in the covenant state itself. Every `transfer` invocation must produce the correct fee UTXOs or the transaction is rejected. The fee is mathematically guaranteed — no opt-out, no off-chain settlement, no marketplaces that "don't support" the standard. This is the first token on any blockchain to enforce revenue sharing at the consensus layer for every transfer.

## Specification

### State Layout

Every KCC-0010 covenant state begins with the KCC-0008 standard header (147 bytes), followed by fee-on-transfer extended state committed via `extended_state_digest`.

#### Standard Header (inherited from KCC-0008)

```
offset  size    field           encoding
0       8       token_id        uint64, big-endian
8       1       token_kind      byte        // 0x00 = FUNGIBLE
9       1       flags           byte        // KCC-0008 flags (the token configuration frozen flag (see KCC-0008 Token Configuration Extended State), BIT_MINTED, BIT_BURNED)
10      32      owner_id        bytes32
42      8       amount          uint64, big-endian
50      64      metadata_uri    padded bytes64, UTF-8
114     32      extended_state_digest bytes32     // blake2b(encode(fee_on_transfer_extended))
```

Total: 147 bytes of standard header.

KCC-0010 restricts `token_kind` to `FUNGIBLE (0x00)`.

#### Fee-on-Transfer Extended State

The extended state is committed by `extended_state_digest = blake2b(encode(fee_extended))` where `fee_extended` is serialized as:

```
offset  size    field                   encoding
0       1       fee_schedule_count      uint8                   // number of fee recipients, 0-255
1       2       total_fee_bps           uint16, big-endian      // cached sum of all bps values
3       1       fee_flags               byte
4       34*N    fee_schedule            FeeScheduleEntry[N]     // ordered array of fee entries
```

Total extended state: `4 + 34 * fee_schedule_count` bytes.

**fee_flags** bitfield:

```
BIT_SCHEDULE_LOCKED = 0x01  // fee_schedule is immutable after first set_fee_schedule
```

#### FeeScheduleEntry (34 bytes each)

```
offset  size    field           encoding
0       32      recipient_id    bytes32     // identity of fee recipient (pubkey hash or covenant id)
32      2       bps             uint16, big-endian  // basis points, range 1-10000
```

Each entry defines one fee recipient and its share. `bps` is in basis points: 100 = 1%, 500 = 5%, 10000 = 100%.

**Constraints on the schedule:**

- `fee_schedule_count` may be 0 (no fees) before `set_fee_schedule` is called.
- Once `BIT_SCHEDULE_LOCKED` is set, the entire extended state becomes immutable.
- Sum of all `bps` values across all entries (stored cached as `total_fee_bps`) must be ≤ 10000.
- No two entries may share the same `recipient_id`.
- Each `bps` must be ≥ 1 (a zero-bps entry is meaningless; omit it instead).

#### Full State (on-chain layout)

The complete covenant state for each UTXO is:

```
offset  size        field                   encoding
0       146         kcc0008_header          (standard header, extended_state_digest commits to below)
146     4+34*N      fee_extended_raw        raw bytes of fee-on-transfer extended state
```

Total: `150 + 34 * fee_schedule_count` bytes per UTXO.

### Core Entrypoints

#### transfer

```
transfer(
    State[] newStates,     // successor states, ordered by covenant output index
    sig[] sigs,       // authorization signatures, positional
    byte[]  witnesses         // per-input metadata (see KCC-0020)
)
```

`transfer` is invoked by the first covenant input as the leader entrypoint. It validates the complete state transition including fee deduction and routing. Remaining covenant inputs invoke `transfer_delegator`.

**Fee deduction math:**

Given a transfer where the sender's consumed UTXOs sum to `sent_amount` for a given `token_id`:

1. For each `fee_schedule[i]`:
   ```
   fee_amount[i] = (sent_amount * bps[i]) / 10000        // integer floor division
   ```
2. `total_fee = sum(fee_amount[0..N-1])`
3. `recipient_amount = sent_amount - total_fee`

Rounding: All fee calculations use integer floor division. Any sub-basis-point remainder is effectively retained by the sender's remaining balance (it does not accumulate or leak). Because `total_fee_bps ≤ 10000`, `total_fee ≤ sent_amount`, guaranteeing `recipient_amount ≥ 0`.

**Dust prevention:**

If `recipient_amount < MIN_OUTPUT` (where `MIN_OUTPUT = 1`), the transfer fails. This prevents dust UTXOs that cost more to spend than they contain. An individual `fee_amount[i]` may be 0 when `(sent_amount * bps[i]) < 10000`. In that case, the fee output for entry `i` is omitted (no zero-amount UTXO is produced).

**Multi-UTXO output construction:**

For a transfer with a single recipient and `N` fee entries (after filtering zero-fee outputs):

- **Output 0** (recipient): `amount = recipient_amount`, `owner_id = recipient_id`, all other state fields preserved from input.
- **Outputs 1..K** (fee routing): One UTXO per fee entry with `fee_amount[i] > 0`. Each has `amount = fee_amount[i]`, `owner_id = fee_schedule[i].recipient_id`, all other state fields preserved from input.

The total number of covenant outputs is `1 + K` where `K` is the count of non-zero fee amounts.

**Multi-input aggregation:**

When multiple UTXOs of the same `token_id` are consumed in one transfer, they are aggregated:
- `sent_amount = sum(consumed[i].amount for all i)`
- Fee deduction is computed once on the aggregate `sent_amount`, not per-input.
- The sender's remaining balance (inputs not consumed) is unaffected.

**Rules enforced by transfer:**

1. For each `token_id` in consumed states: `sum(prev_amounts) == sum(next_amounts)` — conservation includes fee outputs.
2. `token_id`, `token_kind`, and `metadata_uri` are immutable for each consumed state.
3. `fee_schedule_count` and `fee_schedule` are preserved across all outputs — fee schedule is global per token_id.
4. Fee outputs are produced in the same order as `fee_schedule` entries (omitting zero-amount entries).
5. For each consumed input where `witnesses[i] != BORROWED_RECEIVE`: `sigs[i]` must be a valid signature by the owner identified by `owner_id`.
6. `the token configuration frozen flag (see KCC-0008 Token Configuration Extended State)` must not be set on any consumed state.
7. `BIT_BURNED` must not be set on any consumed state.
8. `recipient_amount >= MIN_OUTPUT` (dust guard).
9. If `fee_schedule_count == 0`: no fee outputs are produced (token has no fee configured).

#### transfer_delegator

```
transfer_delegator()
```

Invoked by every non-leader covenant input. Delegates to the leader's `transfer` entrypoint. Enforces that at least one input invoked `transfer` as leader. No input data is required — all logic is driven by the leader's declared transition.

#### set_fee_schedule

```
set_fee_schedule(
    bytes32[] recipient_ids,    // ordered list of fee recipient identities
    uint16[]  bps_values        // corresponding basis points, same length
)
```

Configures the fee schedule for the first (and only) time. Caller must be the covenant owner (the identity that deployed the covenant). Rules:

1. `BIT_SCHEDULE_LOCKED` must not already be set — schedule is immutable after first configuration.
2. `recipient_ids.length == bps_values.length`.
3. `recipient_ids.length` must be ≥ 1 and ≤ 255.
4. Each `bps_values[i]` must be ≥ 1 and ≤ 10000.
5. `sum(bps_values) ≤ 10000`.
6. No duplicate `recipient_ids[i]`.
7. On success: `fee_schedule_count = recipient_ids.length`, `total_fee_bps = sum(bps_values)`, `fee_schedule` is populated with each entry, and `BIT_SCHEDULE_LOCKED` is set.

#### mint

```
mint(
    uint64  token_id,
    uint64  amount,
    bytes64 metadata_uri,
    bytes32 extended_state_digest
)
```

Creates new token supply. Caller must be the covenant owner. Rules:

1. `token_id` must not already exist in the covenant state.
2. `amount` may be any value up to `max_supply` for this `token_id` (configured via `set_token_config` per KCC-0008 owner actions).
3. The `extended_state_digest` must commit to the current fee schedule state (or an empty schedule if not yet configured).
4. On success, a new UTXO is produced with the standard header populated and `flags = BIT_MINTED`.

Note: The fee schedule is global per token. Minted tokens carry the current fee schedule in their extended state — they do not create a new schedule.

#### burn

```
burn(
    uint64 token_id,
    uint64 amount
)
```

Destroys tokens. Caller must be the holder. Rules:

1. Caller's balance for `token_id` must be ≥ `amount`.
2. No fees are deducted from a burn — fees only apply to transfers.
3. On success, the burned state's `flags` is set to `BIT_BURNED`.

#### freeze / unfreeze

```
freeze()
unfreeze()
```

Pauses or resumes all transfers. Caller must be the covenant owner. Sets/clears `the token configuration frozen flag (see KCC-0008 Token Configuration Extended State)` on the covenant-level state. Rules:

1. `freeze` sets `the token configuration frozen flag (see KCC-0008 Token Configuration Extended State)` — all `transfer` invocations fail while set.
2. `unfreeze` clears `the token configuration frozen flag (see KCC-0008 Token Configuration Extended State)` — transfers resume.
3. `mint` and `burn` may still be permitted while frozen (implementation-defined).

### Descriptor

Each KCC-0010 covenant must publish a descriptor:

```
KCC0010Descriptor {
    prefix: bytes              // covenant script bytes before mutable state
    suffix: bytes              // covenant script bytes after mutable state
    token_ids: uint64[]        // token_ids managed by this deployment
    fee_schedule: FeeScheduleEntry[]  // the configured fee schedule (empty if not yet set)
    optional_extensions: ExtensionId[]   // supported extensions (e.g., Borrowed Receive)
}
```

The descriptor allows wallets, DEXes, and indexers to:
- Identify the covenant as KCC-0010.
- Decode the fee schedule without scanning chain state.
- Determine which extensions are available (e.g., whether Borrowed Receive is supported).
- Display fee information to users before they sign a transfer.

### Witness Semantics

Witness values for the `transfer` entrypoint:

```
BORROWED_RECEIVE  = 0xFF   // KCC-0020 Borrowed Receive (exempts authorization)
STANDARD_TRANSFER = 0x00   // normal signed transfer
```

For `transfer_delegator`, witnesses are not used.

For `mint`, `burn`, `set_fee_schedule`, `freeze`, and `unfreeze`, witnesses correspond to standard authorization — the caller provides `sigs[i]` authorizing the state transition.

## Encoding

This standard defines the semantic interface, fee-on-transfer extended state layout, fee deduction math, and multi-UTXO output construction for fee routing. For the byte-level encoding of the transfer leader/delegator pattern, witness positional semantics, Borrowed Receive extension, and KCC-0008 standard header layout, see:

- **KCC-0020** — transfer leader/delegator invocation, positional input/output pairing, witness encoding, sighash construction.
- **KCC-0008** (Multi-Token Standard) — standard header layout, `token_id`/`token_kind`/`flags` fields, `extended_state_digest` commitment, `mint`/`burn`/`approve`/`transfer_from` semantics, profiles, owner actions.

Where this standard extends KCC-0008 and KCC-0020:

- **Fee-on-transfer extended state**: 4-byte header (`fee_schedule_count`, `total_fee_bps`, `fee_flags`) followed by an ordered array of `FeeScheduleEntry` (34 bytes each).
- **Fee deduction logic**: `fee_amount[i] = floor(sent_amount * bps[i] / 10000)`, computed once on aggregate `sent_amount` per transfer.
- **Multi-UTXO fee routing**: one output UTXO per non-zero fee entry, constructed in `fee_schedule` order, with `owner_id` set to the fee recipient's identity.
- **Dust guard**: `recipient_amount >= MIN_OUTPUT`; zero-fee outputs are omitted.
- **Schedule locking**: `BIT_SCHEDULE_LOCKED` in `fee_flags` prevents any modification after `set_fee_schedule`.

### Transfer Output Construction (Encoding Detail)

Given a transfer of `sent_amount` tokens with `fee_schedule` containing `N` entries:

1. **Compute fees**:
   ```
   fees = []
   for i in 0..N-1:
       fee_amount = (sent_amount * fee_schedule[i].bps) / 10000
       if fee_amount > 0:
           fees.append((fee_schedule[i].recipient_id, fee_amount))
   ```

2. **Compute recipient amount**:
   ```
   total_fee = sum(f[1] for f in fees)
   recipient_amount = sent_amount - total_fee
   assert recipient_amount >= MIN_OUTPUT
   ```

3. **Construct output UTXOs** (in this order):
   ```
   outputs = [
       UTXO { amount: recipient_amount,  owner_id: recipient_id,  /* standard header fields preserved */ },
       for each (fee_recipient_id, fee_amount) in fees:
           UTXO { amount: fee_amount,        owner_id: fee_recipient_id, /* standard header fields preserved */ },
   ]
   ```

Each output UTXO preserves `token_id`, `token_kind`, `metadata_uri`, `flags`, and the full extended state (including `fee_schedule`) from the consumed input. The `extended_state_digest` is recomputed and matches across all outputs.

The `amount` field in each output UTXO is set as described. The sum of all output amounts equals `sent_amount`: `recipient_amount + total_fee = sent_amount`.

### Fee Routing Example

Configuration: `fee_schedule = [{recipient: PLATFORM, bps: 200}, {recipient: CREATOR, bps: 500}]` (total: 700 bps = 7%).

Transfer of 1,000,000 tokens:

```
fee_platform = (1000000 * 200) / 10000 = 20000
fee_creator  = (1000000 * 500) / 10000 = 50000
total_fee    = 70000
recipient    = 1000000 - 70000 = 930000
```

Output UTXOs:
```
[0] amount=930000  owner=recipient
[1] amount=20000   owner=PLATFORM
[2] amount=50000   owner=CREATOR
```

## KCC-0020 Alignment

This standard adopts the following from KCC-0020:

- **Transfer interface**: leader/delegator pattern with `transfer(State[], sig[], byte[])` entrypoint signature.
- **Positional input/output pairing**: consumed state at index `i` corresponds to successor state at index `i`.
- **Witness semantics**: positional witness values determine authorization mode.
- **Borrowed Receive**: `witnesses[i] == 0xFF` exempts input from owner authorization while preserving `owner_id`, `token_kind`, `extended_state_digest`.
- **Extended state**: opaque `extended_state_digest` commitment via blake2b.
- **Descriptor**: `prefix/suffix` covenant script bytes for template identification.

This standard also adopts from KCC-0008:

- **Standard header**: 146-byte header with `token_id`, `token_kind`, `flags`, `owner_id`, `amount`, `metadata_uri`, `extended_state_digest`.
- **Mint/burn**: supply creation and destruction with `BIT_MINTED`/`BIT_BURNED` flags.
- **Owner controls**: `freeze`/`unfreeze` via `the token configuration frozen flag (see KCC-0008 Token Configuration Extended State)`.
- **Profiles**: FUNGIBLE only (`token_kind = 0x00`).

Where this standard extends both:

- **Fee-on-transfer extended state**: replaces KCC-0008's opaque extended state with a structured fee schedule.
- **Fee deduction**: `transfer` must produce fee UTXOs computed from `fee_schedule` and `sent_amount`.
- **Schedule locking**: `BIT_SCHEDULE_LOCKED` prevents fee schedule changes after first configuration.
- **Multi-UTXO output**: transfers produce 1+N outputs (recipient + fee recipients) instead of the standard 1-to-1 mapping.

## Profiles

KCC-0010 supports one profile:

| Profile | Detection | Entrypoints |
|---------|-----------|-------------|
| **Fee-on-Transfer Fungible** | `token_kind = 0x00, extended_state_digest commits to fee_schedule with fee_schedule_count > 0` | transfer, set_fee_schedule, mint, burn, freeze, unfreeze |

A token with `fee_schedule_count == 0` behaves identically to a standard KCC-0008 fungible token until `set_fee_schedule` is called.

## Rules

1. `token_kind` must be `FUNGIBLE (0x00)` — fee-on-transfer semantics do not apply to non-fungible tokens.
2. `fee_schedule` is immutable after first `set_fee_schedule` — `BIT_SCHEDULE_LOCKED` prevents any modification.
3. Sum of all `bps` values must be ≤ 10000 (100%).
4. Each `bps` value must be ≥ 1.
5. No duplicate `recipient_id` entries in `fee_schedule`.
6. `fee_schedule_count` must be in range [0, 255].
7. `total_fee_bps` must equal `sum(fee_schedule[i].bps)` — cached for O(1) validation.
8. Fees are deducted from the sent amount: `recipient_amount = sent_amount - sum(fee_amounts)`.
9. Fee amounts are computed via integer floor division: `fee_amount = (sent_amount * bps) / 10000`.
10. `recipient_amount` must be ≥ `MIN_OUTPUT` (dust guard, `MIN_OUTPUT = 1`).
11. Fee outputs with `fee_amount == 0` are omitted — no zero-amount UTXOs are produced.
12. Transfer produces `1 + K` covenant outputs where `K` is the number of non-zero fee amounts.
13. Fee outputs are ordered by `fee_schedule` index (after filtering zero amounts).
14. All output UTXOs preserve `token_id`, `token_kind`, `metadata_uri`, and the full fee extended state from input.
15. Multi-input aggregation: fee calculation is on sum of consumed amounts, not per-input.
16. `burn` does not deduct fees — fees apply only to `transfer`.
17. `freeze` blocks all `transfer` invocations while `the token configuration frozen flag (see KCC-0008 Token Configuration Extended State)` is set.
18. The descriptor must be published before any wallet or indexer can interact with the covenant.
19. `set_fee_schedule` may only be called by the covenant owner.
20. `mint` requires the `extended_state_digest` to commit to the current fee schedule state.

## Use Cases

| Use Case | Schedule | Benefit |
|----------|----------|---------|
| Platform fee | `[{platform: 200}]` | 2% automatic, auditable on every transfer |
| Creator royalty | `[{artist: 500}, {label: 300}]` | Every transfer pays 8%, no marketplace dependency |
| Charity token | `[{charity: 300}]` | 3% verifiable donation on every transaction |
| Affiliate/referral | `[{referrer: 100}]` | 1% trustless commission embedded in token |
| Multi-party revenue | `[{dao: 100}, {dev_fund: 150}, {liquidity: 50}]` | 3% split across stakeholders |
| LP fee token | `[{lp_pool: 250}]` | Automatic 2.5% LP contribution |

## Reference

The author maintains a conforming implementation. This document defines the convention; an implementation demonstrates conformance. For foundational encoding, see:

- **KCC-0008**: Multi-Token Standard — standard header layout, profiles, mint/burn, owner actions.
- **KCC-0020**: Fungible Token Covenant Specification — transfer leader/delegator pattern, witness semantics, Borrowed Receive, sighash construction.
- **KCC-0021**: Token Metadata Standard — canonical metadata URI layout.