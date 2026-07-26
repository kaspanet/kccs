# KCC-0012: Testamentary Token Standards

| Field | Value |
|-------|-------|
| **KCC** | 0012 |
| **Category** | Asset Standard |
| **Title** | Testamentary Tokens — Inheritance, Will, and Trust |
| **Author** | Vida Wallet |
| **Status** | Informational |
| **Created** | 2026-07-25 |
| **Depends on** | KCC-0008 (PR #10, draft), KCC-0020 (PR #2, draft) |

## Abstract

Three token standards for conditional transfer upon death or per fiduciary terms. No blockchain has standardized testamentary instruments as token mechanics. Standard A (Inheritance) implements a dead man's switch — tokens auto-transfer to a designated heir after death is confirmed and a challenge delay expires. Standard B (Will) implements testamentary distribution — a testator designates an executor and multiple beneficiaries with share ratios, plus a contest mechanism with bonded challenges. Standard C (Trust) implements fiduciary trust — a settlor transfers assets to a trustee who manages and distributes per a schedule, with beneficiary enforcement rights and a notary backstop.

## Motivation

Digital assets, stablecoins, and on-chain financial instruments are inheritable in law but not on-chain. Heirs must navigate centralised exchange KYC, seed phrase recovery, and legal probate — processes measured in months while the assets sit frozen. Testamentary token standards make inheritance programmatic: death is confirmed through configurable methods (oracle attestation, social consensus, inactivity), a challenge delay prevents false triggers, and distribution executes atomically. Trust standards go further, enabling ongoing fiduciary management with beneficiary oversight — a primitive no blockchain ecosystem has shipped.

---

## Standard A: Inheritance — Dead Man's Switch

Tokens auto-transfer to a designated heir when death is confirmed and a challenge delay expires.

### A.1 State Layout

Every Standard A covenant state begins with the following fields, in this order and encoding:

```
offset  size    field               encoding
0       32      owner               bytes32 (public key hash)
32      32      heir                bytes32 (public key hash)
64      1       death_method        byte
65      1       status              byte
66      6       reserved            zero padding
72      8       last_heartbeat      uint64, big-endian (block height)
80      8       delay_blocks        uint64, big-endian
88      32      method_params       bytes32 (union, interpreted per death_method)
120     32      extended_state_digest     bytes32
```

Total: 152 bytes.

**death_method** values:

```
ORACLE      = 0x00  // oracle attestation of death certificate
SOCIAL      = 0x01  // N-of-M guardian signatures confirming death
INACTIVITY  = 0x02  // no heartbeat for inactivity_blocks
```

**status** values:

```
ACTIVE      = 0x00  // owner alive, heartbeat window open
DECEASED    = 0x01  // death confirmed, challenge delay in progress
CLAIMED     = 0x02  // heir has claimed (terminal state)
```

**method_params** interpretation per death_method:

When `death_method == ORACLE (0x00)`:

```
offset  size    field
0       32      oracle_id           bytes32 (operator public key from Oracle Registry)
```

When `death_method == SOCIAL (0x01)`:

```
offset  size    field
0       1       guardian_count      byte (N, range 1–15)
1       1       threshold           byte (M, range 1–N)
2       30      guardian_set_hash   bytes30 (first 30 bytes of blake2b over ordered guardian pubkey list)
```

The full 32-byte blake2b hash is truncated to 30 bytes for the guardian_set_hash field. When verifying guardian signatures, the covenant recomputes blake2b over the provided guardian list and compares the first 30 bytes.

When `death_method == INACTIVITY (0x02)`:

```
offset  size    field
0       8       inactivity_blocks    uint64, big-endian
8       24      reserved             zero
```

**extended_state_digest** commits to covenant-specific data beyond the standard header. Computed as:

```
extended_state_digest = blake2b(encode(extended_state))
```

### A.2 Entrypoint Signatures

#### set_heir

```
set_heir(
    bytes32 heir,
    byte    death_method,
    bytes   method_data,
    uint64  delay_blocks
)
```

Designates an heir and configures the death confirmation method. Caller must be the current `owner`.

Rules enforced:

1. `status` must be `ACTIVE`. Heir cannot be changed after death is confirmed.
2. `heir` must not equal `owner` and must not be the zero address.
3. `death_method` must be one of `ORACLE (0x00)`, `SOCIAL (0x01)`, or `INACTIVITY (0x02)`.
4. `method_data` encoding depends on `death_method`:
   - **ORACLE**: 32 bytes — the `oracle_id` from the Oracle Registry (per KCC-0018).
   - **SOCIAL**: 1 byte N, 1 byte M, then N × 32 bytes of ordered guardian pubkeys. M must be ≤ N, N must be ≥ 1 and ≤ 15.
   - **INACTIVITY**: 8 bytes — `inactivity_blocks` as uint64 BE.
5. `delay_blocks` must be ≥ 1. This is the challenge window after death confirmation before the heir can claim.
6. After successful execution, `last_heartbeat` is set to the current block height.
7. `set_heir` may be called multiple times while `status == ACTIVE`, overwriting the prior heir and confirmation method.

#### heartbeat

```
heartbeat()
```

Owner proves they are alive. Caller must be the current `owner`.

Rules enforced:

1. `status` must be `ACTIVE`.
2. Sets `last_heartbeat` to the current block height.
3. No other state changes. Entrypoint exists solely to refresh the liveness timestamp.

Heartbeat is intentionally lightweight — no signatures beyond the standard transaction authorization, no data payload. The owner sends a heartbeat by invoking this entrypoint in a transaction; the block height of inclusion becomes the new `last_heartbeat`.

#### confirm_death

```
confirm_death(
    byte[] proof
)
```

Triggers death confirmation. May be called by anyone (heir, guardian, oracle relayer, or third party). The caller need not be a party to the covenant.

Rules enforced:

1. `status` must be `ACTIVE`.
2. Proof validation depends on `death_method`:
   - **ORACLE**: `proof` must be a valid oracle attestation (per KCC-0017 format) where:
     - The attestation `pair` field encodes `"DEATH:" || owner[0:26]` (null-padded to 32 bytes).
     - The `operator_id` in the attestation matches `method_params.oracle_id`.
     - The attestation signature is valid.
     - The `timestamp` is within the oracle's freshness window.
   - **SOCIAL**: `proof` must contain M valid signatures over `(owner, current_block_height)`, each from a distinct guardian in the ordered guardian set whose hash matches `method_params.guardian_set_hash`. The covenant recomputes blake2b over the provided guardian pubkeys and verifies the first 30 bytes match.
   - **INACTIVITY**: `proof` is empty. Death is confirmed when `current_block_height - last_heartbeat >= method_params.inactivity_blocks`. The caller simply triggers the check.
3. On successful confirmation, `status` transitions to `DECEASED`.
4. The current block height is recorded as the confirmation block (implicit in the UTXO's inclusion height).

#### claim

```
claim()
```

Heir claims the tokens after death confirmation and challenge delay. Caller must be the `heir`.

Rules enforced:

1. `status` must be `DECEASED`.
2. The block height at which `confirm_death` was executed (recoverable from the prior UTXO's confirmation height) plus `delay_blocks` must be ≤ current block height.
3. On success, `status` transitions to `CLAIMED` (terminal).
4. The covenant's tokens are transferred to `heir`'s control. The covenant UTXO is consumed — no successor covenant state is required.

### A.3 Descriptor

```
KCC0012A_Descriptor {
    prefix: bytes              // covenant script bytes before mutable state
    suffix: bytes              // covenant script bytes after mutable state
    death_methods: byte[]      // supported death_method values
    max_delay_blocks: uint64   // maximum allowed delay_blocks (covenant compile-time parameter)
}
```

---

## Standard B: Will — Testamentary Distribution

Multi-beneficiary distribution per testator's terms, executed by a designated executor, with a contest mechanism and notary backstop.

### B.1 State Layout

```
offset  size    field               encoding
0       32      testator            bytes32 (public key hash)
32      32      executor            bytes32 (public key hash)
64      32      notary              bytes32 (public key hash)
96      1       beneficiary_count   byte (range 1–32)
97      1       status              byte
98      1       death_method        byte
99      5       reserved            zero padding
104     8       contest_bond        uint64, big-endian (sompi)
112     8       contest_duration    uint64, big-endian (blocks)
120     8       delay_blocks        uint64, big-endian
128     32      beneficiary_hash    bytes32 (blake2b over ordered beneficiary list)
160     32      distribution_map    bytes32 (blake2b over per-beneficiary claimed amounts)
192     32      extended_state_digest     bytes32
```

Total: 224 bytes.

**status** values:

```
DRAFT           = 0x00  // will terms set, not yet activated
ACTIVE          = 0x01  // testator alive, will in force
DECEASED        = 0x02  // death confirmed, delay in progress
DISTRIBUTING    = 0x03  // executor may distribute
DISTRIBUTED     = 0x04  // all beneficiaries claimed (terminal)
CONTESTED       = 0x05  // at least one active contest
RESOLVED        = 0x06  // contest resolved by notary, back to DISTRIBUTING
```

**death_method** values: same as Standard A (§A.1).

**beneficiary_hash** is computed as:

```
beneficiary_hash = blake2b(
    encode_beneficiary(beneficiaries[0]) ||
    encode_beneficiary(beneficiaries[1]) ||
    ...
)
```

Where `encode_beneficiary` packs:

```
beneficiary_pubkey: bytes32
share_bps:          uint16, big-endian
vesting_delay:      uint64, big-endian (blocks; 0 = immediate)
```

Each beneficiary record is 42 bytes. Maximum 32 beneficiaries (1344 bytes of beneficiary data, provided as witness and verified against `beneficiary_hash`).

`share_bps` values across all beneficiaries must sum to exactly 10000 (100%).

**distribution_map** tracks which beneficiaries have claimed. Initialized to all zeros. Each beneficiary corresponds to one bit in the map (bit `i` for beneficiary index `i`). Bit is set to 1 when the beneficiary's share has been distributed. This prevents double-claiming.

### B.2 Entrypoint Signatures

#### set_beneficiaries

```
set_beneficiaries(
    Beneficiary[]   beneficiaries,
    bytes32         executor,
    bytes32         notary,
    byte            death_method,
    bytes           method_data,
    uint64          delay_blocks,
    uint64          contest_bond,
    uint64          contest_duration
)
```

Defines the will terms. Caller must be the `testator`.

Rules enforced:

1. `status` must be `DRAFT` (initial call) or `ACTIVE` (amendment; see rule 8).
2. `beneficiaries` must have 1–32 entries. Every `share_bps` must be > 0. Sum of all `share_bps` must equal 10000.
3. `executor` must not be zero address. Must not equal `testator`.
4. `notary` must not be zero address. Must not equal `testator` or `executor`.
5. `death_method` and `method_data` follow the same encoding as Standard A (§A.2, `set_heir`).
6. `delay_blocks` must be ≥ 1.
7. `contest_bond` is the amount (in sompi) a beneficiary must lock to file a contest. Must be > 0.
8. `contest_duration` is the maximum blocks a contest may remain unresolved before the notary must rule. Must be ≥ 1.
9. If called when `status == ACTIVE` (amendment): the testator may update beneficiaries, executor, or parameters. All existing distribution state is preserved. Active contests (if any) remain. This is the testator's right to amend their will while alive.
10. On first call, `status` transitions from `DRAFT` to `ACTIVE`.

Beneficiary struct encoding for witness data:

```
struct Beneficiary {
    bytes32 pubkey;       // beneficiary public key hash
    uint16  share_bps;    // share in basis points (1–10000)
    uint64  vesting_delay; // blocks after death before share vests (0 = immediate)
}
```

#### confirm_death

```
confirm_death(
    byte[] proof
)
```

Confirms the testator's death. Caller must be the `executor`.

Rules enforced:

1. `status` must be `ACTIVE`.
2. Proof validation follows Standard A (§A.2, `confirm_death`), using `death_method` and `method_data`.
3. On success, `status` transitions to `DECEASED`. The confirmation block height is recorded.
4. After `delay_blocks` elapse from the confirmation block, the executor may call `distribute`.

#### distribute

```
distribute(
    uint8 beneficiary_index
)
```

Executor distributes the will to one beneficiary. Caller must be the `executor`.

Rules enforced:

1. `status` must be `DECEASED` or `DISTRIBUTING`.
2. On first call after death (status == `DECEASED`): `status` transitions to `DISTRIBUTING`. Remains `DISTRIBUTING` for subsequent calls.
3. `current_block_height - death_confirmation_height >= delay_blocks`.
4. `beneficiary_index` must be < `beneficiary_count`.
5. The beneficiary's bit in `distribution_map` must not already be set (no double-claiming).
6. The beneficiary's `vesting_delay` must have elapsed: `current_block_height - death_confirmation_height >= beneficiary.vesting_delay`.
7. The distributed amount = `total_tokens × beneficiary.share_bps / 10000`.
8. On success: the beneficiary's bit is set in `distribution_map`. Tokens are transferred to the beneficiary.
9. If all bits in `distribution_map` are set after distribution, `status` transitions to `DISTRIBUTED` (terminal).

#### contest

```
contest(
    uint8   beneficiary_index,
    bytes   reason
)
```

A beneficiary challenges the distribution by posting a bond. Caller must be the beneficiary at `beneficiary_index`.

Rules enforced:

1. `status` must be `DISTRIBUTING`.
2. The beneficiary's bit in `distribution_map` must not already be set (beneficiary must still have an unclaimed share to contest).
3. The caller must lock exactly `contest_bond` sompi — this is enforced by the covenant examining the transaction's input value. If the bond is insufficient or excess, the call fails.
4. `reason` is an opaque byte string (max 256 bytes) recording the grounds for the contest. Stored off-chain; the covenant only records that a contest was filed.
5. On success, `status` transitions to `CONTESTED`. The contest metadata (beneficiary_index, bond amount, filing block) is recorded in the covenant's extended state.
6. The bond is held by the covenant until `resolve` is called.
7. Only one active contest may exist at a time. If `status == CONTESTED`, `contest` fails.

#### resolve

```
resolve(
    uint8 ruling,
    bytes reason
)
```

The notary resolves an active contest. Caller must be the `notary`.

Rules enforced:

1. `status` must be `CONTESTED`.
2. `ruling` values:
   - `0x00` — **UPHELD**: contest is valid. The contesting beneficiary receives their full share. The bond is returned to the contesting beneficiary.
   - `0x01` — **REJECTED**: contest is invalid. The bond is slashed — distributed pro-rata to all other unclaimed beneficiaries (including the executor if executor is a beneficiary). The contesting beneficiary's share remains claimable per the original terms.
   - `0x02` — **ADJUSTED**: the notary modifies the contesting beneficiary's share. `reason` must encode the new `share_bps` as a uint16 BE in the first 2 bytes. The bond is returned to the contesting beneficiary. Other beneficiaries' shares are reduced pro-rata to accommodate the adjustment.
3. `reason` documents the notary's ruling (opaque bytes, max 256 bytes). Stored off-chain.
4. On success, `status` transitions back to `DISTRIBUTING`. The bond is disposed per the ruling.

### B.3 Descriptor

```
KCC0012B_Descriptor {
    prefix: bytes
    suffix: bytes
    max_beneficiaries: uint8       // compile-time cap (≤ 32)
    max_contest_bond: uint64       // compile-time cap in sompi
    max_contest_duration: uint64   // compile-time cap in blocks
    death_methods: byte[]
}
```

---

## Standard C: Trust — Fiduciary Trust

A settlor transfers assets into a trust. A trustee manages and distributes per a schedule. Beneficiaries can enforce terms via a notary.

### C.1 State Layout

```
offset  size    field               encoding
0       32      settlor             bytes32 (public key hash)
32      32      trustee             bytes32 (public key hash)
64      32      notary              bytes32 (public key hash)
96      1       beneficiary_count   byte (range 1–32)
97      1       schedule_count      byte (range 0–16)
98      1       status              byte
99      5       reserved            zero padding
104     8       end_date            uint64, big-endian (block height; 0 = perpetual)
112     8       last_distribution   uint64, big-endian (block height of last distribution)
120     32      beneficiary_hash    bytes32 (blake2b over ordered beneficiary list)
152     32      schedule_hash       bytes32 (blake2b over ordered schedule list)
184     32      terms_hash          bytes32 (blake2b over trust terms document)
216     32      extended_state_digest     bytes32
```

Total: 248 bytes.

**status** values:

```
UNSETTLED       = 0x00  // trust created but no assets settled
ACTIVE          = 0x01  // trust funded, trustee managing
TERMINATED      = 0x02  // trust ended, remainder distributed (terminal)
```

**beneficiary_hash** encodes each beneficiary as:

```
beneficiary_pubkey: bytes32
share_bps:          uint16, big-endian
schedule_index:     uint8  (0–15; 0xFF = residual beneficiary)
reserved:           byte   (zero)
```

Each beneficiary record is 36 bytes. Maximum 32 beneficiaries (1152 bytes, provided as witness).

`schedule_index` maps the beneficiary to a distribution schedule. Value `0xFF` designates the residual beneficiary — receives all remaining assets on trust termination.

`share_bps` values across all beneficiaries must sum to exactly 10000.

**schedule_hash** encodes each schedule as:

```
schedule_type:      byte
interval_blocks:    uint64, big-endian
amount_fixed:       uint64, big-endian (sompi; 0 = percentage-based)
amount_bps:         uint16, big-endian (0 = fixed-amount)
start_block:        uint64, big-endian (0 = from settlement)
reserved:           byte (zero)
```

Each schedule record is 31 bytes. Maximum 16 schedules (496 bytes, provided as witness).

`schedule_type` values:

```
FIXED_INTERVAL  = 0x00  // distribute amount_fixed every interval_blocks
PERCENTAGE      = 0x01  // distribute amount_bps/10000 of remaining every interval_blocks
ONE_TIME        = 0x02  // single distribution at start_block
DURATION_BASED  = 0x03  // amount_fixed over interval_blocks, linear vesting per block
```

When `schedule_type == FIXED_INTERVAL`: `amount_fixed` is the sompi amount per distribution, and `amount_bps` must be 0.
When `schedule_type == PERCENTAGE`: `amount_bps` is in basis points of remaining trust assets, and `amount_fixed` must be 0.

### C.2 Entrypoint Signatures

#### settle

```
settle(
    Beneficiary[]   beneficiaries,
    Schedule[]      schedules,
    bytes32         terms_hash,
    bytes32         trustee,
    bytes32         notary,
    uint64          end_date
)
```

Transfers assets into the trust and activates it. Caller must be the `settlor`.

Rules enforced:

1. `status` must be `UNSETTLED`.
2. `beneficiaries` must have 1–32 entries. Sum of `share_bps` must equal 10000. Exactly one beneficiary must have `schedule_index == 0xFF` (residual beneficiary).
3. `schedules` must have 0–16 entries. If `schedule_count == 0`, the trust is a simple hold with no scheduled distributions (all assets distributed on `terminate`).
4. `trustee` must not be zero address. Must not equal `settlor`.
5. `notary` must not be zero address. Must not equal `settlor` or `trustee`.
6. `end_date`: if non-zero, must be > current block height. If zero, the trust is perpetual (indefinite duration).
7. The settlor's tokens are transferred into the trust covenant. The covenant becomes the holder of the trust assets.
8. On success, `status` transitions to `ACTIVE`. `last_distribution` is set to current block height.

#### manage

```
manage(
    State[] newStates,
    sig[] sigs,
    byte[]  witnesses
)
```

Trustee manages trust assets — rebalancing, swapping, or redeploying within the trust terms. Caller must be the `trustee`.

Rules enforced:

1. `status` must be `ACTIVE`.
2. The total value of trust assets after management must be ≥ the total value before management (no dissipation). Value is determined by oracle attestation at the time of the transaction.
3. `terms_hash` must remain unchanged — the trust terms document cannot be modified by `manage`.
4. The trustee may not transfer assets to any address controlled by the trustee personally (self-dealing prevention). The `next_states` must route to covenant-controlled outputs or approved counterparties whose pubkey hashes are committed to in the trust terms.
5. Management actions that reduce the trust corpus below what is needed to satisfy the next scheduled distribution must fail.
6. `beneficiary_hash` and `schedule_hash` are preserved unchanged.

`manage` adopts the positional input/output pairing pattern from KCC-0020 (see KCC-0020 Alignment below) but extends it with value-preservation and self-dealing checks.

#### distribute

```
distribute(
    uint8 schedule_index
)
```

Trustee executes a scheduled distribution. Caller must be the `trustee`.

Rules enforced:

1. `status` must be `ACTIVE`.
2. `schedule_index` must be < `schedule_count`.
3. For the referenced schedule:
   - **FIXED_INTERVAL**: `current_block_height - last_distribution >= schedule.interval_blocks`. Distributes `schedule.amount_fixed` sompi.
   - **PERCENTAGE**: `current_block_height - last_distribution >= schedule.interval_blocks`. Distributes `trust_balance × schedule.amount_bps / 10000` sompi.
   - **ONE_TIME**: `current_block_height >= schedule.start_block` AND this schedule has not been triggered before. Distributes `schedule.amount_fixed` sompi. Schedule is marked as triggered in extended state.
   - **DURATION_BASED**: distributes `schedule.amount_fixed × (current_block_height - schedule.start_block) / schedule.interval_blocks` sompi, capped at `schedule.amount_fixed`.
4. The distributed amount is split among beneficiaries mapped to this schedule_index, proportional to their `share_bps`.
5. On success, `last_distribution` is updated to current block height.
6. If the trust balance after distribution is zero and all schedules are exhausted, the trust does not auto-terminate — `terminate` must be called explicitly or `end_date` must pass.

#### replace_trustee

```
replace_trustee(
    bytes32 new_trustee,
    Sig[]   approvals
)
```

Replaces the trustee. Caller may be the `settlor` (unilateral) or beneficiaries (by supermajority).

Rules enforced:

1. `status` must be `ACTIVE`.
2. If called by `settlor`: no further approvals needed. The settlor may replace the trustee at any time.
3. If called by beneficiaries: `approvals` must contain signatures from beneficiaries representing > 66% of total `share_bps` (supermajority). Each signature covers `(new_trustee, current_block_height)`.
4. `new_trustee` must not be zero address. Must not equal `settlor`.
5. On success, `trustee` is set to `new_trustee`.

#### enforce

```
enforce(
    bytes   complaint,
    uint64  bond_amount
)
```

A beneficiary challenges trustee actions by posting a bond. Caller must be a beneficiary.

Rules enforced:

1. `status` must be `ACTIVE`.
2. The caller's pubkey must match a pubkey in the beneficiary list (verified against `beneficiary_hash`).
3. `bond_amount` must be ≥ the covenant's configured minimum enforcement bond (compile-time parameter).
4. `complaint` is an opaque byte string (max 512 bytes) documenting the alleged breach. Stored off-chain.
5. The bond is locked in the covenant. It is returned if the notary upholds the complaint; slashed to the trustee if rejected.
6. On success, the trust enters a frozen state: no further `manage` or `distribute` calls are permitted until the notary rules.
7. The notary is notified (off-chain event). The notary must call `resolve_enforcement` to unfreeze.

#### resolve_enforcement

```
resolve_enforcement(
    uint8   ruling,
    bytes   reason
)
```

Notary rules on an enforcement action. Caller must be the `notary`.

Rules enforced:

1. Trust must be in the frozen state (triggered by `enforce`).
2. `ruling` values:
   - `0x00` — **UPHELD**: complaint valid. Bond returned to beneficiary. Trustee may be subject to `replace_trustee`. The notary may order a specific remedial action encoded in `reason`.
   - `0x01` — **REJECTED**: complaint invalid. Bond transferred to trustee. Trust unfreezes.
3. On success, trust is unfrozen. Normal operations resume.

#### terminate

```
terminate()
```

Ends the trust and distributes remaining assets to the residual beneficiary (the beneficiary with `schedule_index == 0xFF`).

Rules enforced:

1. `status` must be `ACTIVE`.
2. At least one of the following must be true:
   - `end_date != 0` AND `current_block_height >= end_date`.
   - Called by `settlor` (settlor may terminate at any time).
   - All non-residual beneficiaries have received their full scheduled distributions.
3. On success, all remaining trust assets are transferred to the residual beneficiary. `status` transitions to `TERMINATED` (terminal).

### C.3 Descriptor

```
KCC0012C_Descriptor {
    prefix: bytes
    suffix: bytes
    max_beneficiaries: uint8
    max_schedules: uint8
    min_enforcement_bond: uint64    // minimum sompi for enforce()
    perpetual_allowed: bool          // whether end_date=0 is permitted
}
```

---

## Death Confirmation Encoding

This section defines the on-chain encoding of death confirmation proofs used by Standard A and Standard B.

### D.1 ORACLE Confirmation

Death confirmation via oracle attestation follows KCC-0017 (Oracle Attestation Format) with a domain-specific pair encoding.

**Pair field encoding:**

```
"DEATH:" || owner_pubkey[0:26]
```

The string `"DEATH:"` (6 ASCII bytes) followed by the first 26 bytes of the owner's pubkey hash, null-padded to 32 bytes.

The oracle signs an attestation asserting the death of the person identified by `owner_pubkey`. The covenant verifies:

1. Attestation format version = 0x01.
2. `pair[0:6]` = `"DEATH:"` (ASCII).
3. `pair[6:32]` matches `owner[0:26]`.
4. `operator_id` matches `method_params.oracle_id`.
5. Signature is valid over bytes 0–96 of the attestation.
6. `timestamp` is within the covenant's freshness window (typically 24 hours of blocks).

**Attestation payload structure for death confirmation:**

```
[version: 1 byte]           = 0x01
[pair: 32 bytes]            = "DEATH:" || owner[0:26] || zero-pad
[price_numerator: 8 bytes]  = 1 (death confirmed)
[price_denominator: 8 bytes] = 1
[timestamp: 8 bytes]        = Unix milliseconds of death certificate observation
[block_height: 8 bytes]     = Kaspa block at observation
[nonce: 8 bytes]            = monotonic, operator-specific
[operator_id: 32 bytes]     = oracle operator pubkey
[signature: 64 bytes]       = SECP256k1 signature over bytes 0–96
```

The `price_numerator` and `price_denominator` fields are repurposed as a boolean confirmation flag: `(1, 1)` means death confirmed. `(0, 1)` explicitly means NOT confirmed (not used by the covenant but may be produced by the oracle for queries).

### D.2 SOCIAL Confirmation

Death confirmation via N-of-M guardian signatures.

**Guardian set encoding (off-chain, provided as witness to `confirm_death`):**

```
[N: 1 byte]
[M: 1 byte]
[guardian_pubkey_1: 32 bytes]
[guardian_pubkey_2: 32 bytes]
...
[guardian_pubkey_N: 32 bytes]
```

Total: 2 + (N × 32) bytes.

**Covenant verification:**

1. Parse N and M from witness data.
2. Read N guardian pubkeys.
3. Order them lexicographically by pubkey bytes.
4. Compute `blake2b(ordered_guardian_list)`. Compare first 30 bytes to `method_params.guardian_set_hash`.
5. Read M signatures from `proof`. Each signature is 64 bytes (SECP256k1).
6. The signed message for each guardian is: `blake2b(owner || block_height)` — 40 bytes.
7. Verify each signature against a distinct guardian pubkey from the set.
8. All M signatures must be valid and from distinct guardians.

**Proof encoding for SOCIAL `confirm_death`:**

```
[guardian_set: 2 + N*32 bytes]   // the full ordered guardian list (verified against hash)
[signature_1: 64 bytes]           // SECP256k1
[signature_2: 64 bytes]
...
[signature_M: 64 bytes]
```

Total: 2 + N×32 + M×64 bytes.

Maximum size with N=15, M=15: 2 + 480 + 960 = 1442 bytes.

### D.3 INACTIVITY Confirmation

Death confirmation via heartbeat absence. No proof data is required — the covenant checks the block height differential against its own state.

**Covenant verification:**

```
assert status == ACTIVE
assert (current_block_height - last_heartbeat) >= method_params.inactivity_blocks
```

The `confirm_death` entrypoint with `death_method == INACTIVITY` accepts an empty `proof` parameter. The caller's role is solely to trigger the check — any third party may submit the transaction.

---

## Contest and Bond Mechanism

Standard B includes a bonded contest system. This section specifies the bond lifecycle.

### Bond Lifecycle

1. **Filing**: A beneficiary calls `contest(beneficiary_index, reason)` and locks `contest_bond` sompi. The bond is held by the covenant UTXO.
2. **Holding**: While `status == CONTESTED`, the bond is inaccessible. No party may withdraw it. The covenant's balance includes the bond.
3. **Resolution**: The notary calls `resolve(ruling, reason)`.
   - `UPHELD (0x00)`: bond returned to contesting beneficiary in the same transaction.
   - `REJECTED (0x01)`: bond slashed — distributed to all OTHER unclaimed beneficiaries pro-rata by their `share_bps`. If the executor is also a beneficiary, they participate in the slash distribution per their share.
   - `ADJUSTED (0x02)`: bond returned to contesting beneficiary. Share is adjusted per notary ruling.

### Bond Amount

The `contest_bond` is set by the testator at will creation and must be:
- Sufficient to deter frivolous contests
- Not so high as to prevent legitimate challenges

The covenant enforces that the locked amount exactly equals `contest_bond` — no partial bonds. This is checked by inspecting the transaction input value.

### Contest Duration

If `status == CONTESTED` for more than `contest_duration` blocks without a `resolve` call:

1. Any party (executor, beneficiary, or third party) may call `resolve` on the notary's behalf with a default `REJECTED` ruling if the notary has signed a default judgment.
2. If the notary fails to rule within `contest_duration × 2` blocks, the contest auto-resolves as `REJECTED` and the bond is slashed. This prevents denial-of-service via notary inaction.

### Slashing Distribution

When a bond is slashed (`REJECTED` ruling), the distribution formula is:

```
For each unclaimed beneficiary i (distribution_map bit i == 0):
    slash_share_i = contest_bond × beneficiary[i].share_bps / (10000 - contesting_beneficiary.share_bps)
```

The contesting beneficiary receives nothing from the slash. The executor, if a beneficiary, participates per their share_bps.

---

## Trust Distribution Schedule Encoding

Standard C schedules are encoded as a fixed-size record per schedule. This section specifies the binary format.

### Schedule Record (32 bytes)

```
offset  size    field               encoding
0       1       schedule_type       byte
1       1       flags               byte
2       6       reserved            zero padding
8       8       interval_blocks     uint64, big-endian
16      8       amount_fixed        uint64, big-endian
24      2       amount_bps          uint16, big-endian
26      6       start_block         uint48, big-endian (0 = from settlement)
```

Total: 32 bytes per schedule record. `start_block` uses uint48, representing block heights up to ~2.8×10^14 — far beyond any practical chain length. When `start_block == 0`, distributions begin from the settlement block.

**schedule_type** values:

```
FIXED_INTERVAL  = 0x00
PERCENTAGE      = 0x01
ONE_TIME        = 0x02
DURATION_BASED  = 0x03
```

**flags** bitfield:

```
BIT_TRIGGERED   = 0x01  // ONE_TIME schedule has been distributed
BIT_EXHAUSTED   = 0x02  // schedule has no remaining distributions
```

**Field usage by schedule_type:**

| Field | FIXED_INTERVAL | PERCENTAGE | ONE_TIME | DURATION_BASED |
|-------|:---:|:---:|:---:|:---:|
| interval_blocks | interval between distributions | interval between distributions | ignored | total vesting duration |
| amount_fixed | sompi per distribution | ignored | sompi to distribute once | total sompi to vest |
| amount_bps | ignored | basis points of remaining | ignored | ignored |
| start_block | distributions begin | distributions begin | distribution trigger block | vesting start block |

### Trust Terms Hash

`terms_hash` commits to the off-chain trust document. Computed as:

```
terms_hash = blake2b(trust_document_bytes)
```

The trust document is a legal instrument (e.g., a PDF of the trust deed). The hash is a content commitment — any modification to the trust terms changes the hash, and the covenant rejects `manage` calls that would violate the original terms. Enforcement actions reference `terms_hash` to demonstrate breach of specific clauses (clause references are carried in the `complaint` field).

---

## Encoding

This standard defines the full byte-level encoding for testamentary token covenants. Unlike KCC-0020-based token standards, testamentary tokens do not implement a standard transfer leader/delegator pattern. Each sub-standard defines its own entrypoint set with domain-specific encoding.

### A. Inheritance State Encoding

Standard A state is 152 bytes. The fixed layout is defined in §A.1. The `method_params` field is a union whose interpretation depends on `death_method`:

- `ORACLE`: `method_params[0:32]` = `oracle_id` (bytes32). Bytes 32+ are reserved.
- `SOCIAL`: `method_params[0]` = N (guardian count), `method_params[1]` = M (threshold), `method_params[2:32]` = `guardian_set_hash` (bytes30).
- `INACTIVITY`: `method_params[0:8]` = `inactivity_blocks` (uint64 BE). Bytes 8+ are reserved.

### B. Will State Encoding

Standard B state is 224 bytes (§B.1). Beneficiary data and distribution tracking are committed via hash:

- `beneficiary_hash`: blake2b over concatenated beneficiary records (42 bytes each).
- `distribution_map`: 32-byte bitmap. Bit `i` corresponds to beneficiary index `i`. Set to 1 when claimed. Bits beyond `beneficiary_count` are reserved (must be 0).

### C. Trust State Encoding

Standard C state is 248 bytes (§C.1). Beneficiary and schedule data are committed via hash:

- `beneficiary_hash`: blake2b over concatenated beneficiary records (36 bytes each).
- `schedule_hash`: blake2b over concatenated schedule records (32 bytes each).
- `terms_hash`: blake2b over the trust document.

### D. Witness Data Encoding

**set_heir method_data** (Standard A):

- ORACLE: 32 bytes — `oracle_id`.
- SOCIAL: `[N: 1 byte][M: 1 byte][guardian_1: 32 bytes]...[guardian_N: 32 bytes]`. N ≤ 15, M ≤ N.
- INACTIVITY: 8 bytes — `inactivity_blocks` as uint64 BE.

**set_beneficiaries beneficiaries** (Standard B):

Array of beneficiary records. Each record: `[pubkey: 32 bytes][share_bps: 2 bytes BE][vesting_delay: 8 bytes BE]`. Array length = `beneficiary_count`.

**settle beneficiaries** (Standard C):

Array of beneficiary records. Each record: `[pubkey: 32 bytes][share_bps: 2 bytes BE][schedule_index: 1 byte][reserved: 1 byte]`. Array length = `beneficiary_count`.

**settle schedules** (Standard C):

Array of schedule records (32 bytes each, per the Trust Distribution Schedule Encoding section above). Array length = `schedule_count`.

### E. Authorization

All entrypoints that modify covenant state require authorization from the caller identified in the entrypoint's caller constraint:

- Standard A: `owner` (set_heir, heartbeat), `heir` (claim), anyone (confirm_death).
- Standard B: `testator` (set_beneficiaries), `executor` (confirm_death, distribute), beneficiary (contest), `notary` (resolve).
- Standard C: `settlor` (settle, terminate, replace_trustee), `trustee` (manage, distribute), beneficiary (enforce), `notary` (resolve_enforcement).

Authorization is enforced via standard Kaspa signature verification: the transaction must include a valid signature over the sighash by the private key corresponding to the caller's pubkey hash.

---

## KCC-0020 Alignment

This standard's relationship to KCC-0020 is limited. Testamentary tokens are fundamentally non-standard transfer patterns. This section documents what is adopted, what is extended, and what is incompatible.

### Adopted from KCC-0020

- **Descriptor pattern**: `prefix/suffix` covenant script bytes for template identification. Each sub-standard publishes a descriptor (§A.3, §B.3, §C.3).
- **Extended digest**: `extended_state_digest = blake2b(encode(extended_state))` for committing to covenant-specific data beyond the standard header.
- **Positional witness semantics** (Standard C only): `manage` adopts positional input/output pairing where consumed state at index `i` corresponds to successor state at index `i`. This is the only entrypoint across all three standards that resembles KCC-0020's transfer pattern.

### Not Adopted from KCC-0020

- **Transfer leader/delegator pattern**: None of the three standards implements `transfer(State[], sig[], byte[])` with a `transfer_delegator()` companion. Standard A has no transfer entrypoint at all — the dead man's switch releases tokens on death confirmation, not on a holder's transfer instruction.
- **Borrowed Receive (witness 0xFF)**: Not applicable. There is no standard transfer to exempt authorization from.
- **Fungible token semantics**: Testamentary tokens operate on the covenant's entire balance, not on per-token_id fungible units. There is no `token_id`, `token_kind`, `amount`, or `metadata_uri` field.
- **Approve/transfer_from allowance system**: Not applicable. Testamentary tokens have no allowance or delegated transfer mechanism.

### Testamentary-Specific Patterns

These patterns have no analogue in KCC-0020 or any existing Kaspa token standard:

- **Conditional release on external event**: Tokens are released based on death confirmation (oracle, social consensus, inactivity) — an external condition verified on-chain, not a holder-initiated transfer.
- **Challenge delay window**: A configurable delay between death confirmation and claim prevents false triggers. No KCC-0020 token has a delay window.
- **Executor-mediated distribution**: Standard B uses a third-party executor to distribute per predefined share ratios. This is not a transfer — the executor is not the holder and does not authorize a standard transfer.
- **Bonded contest**: Beneficiaries lock a bond to challenge distribution. Bond slashing and notary resolution have no KCC-0020 analogue.
- **Schedule-based vesting within a trust**: Standard C distributes per a predefined schedule encoded in the covenant. This combines vesting mechanics (cf. KCC-0015) with fiduciary management — a composite primitive not covered by KCC-0020.
- **Trustee management with value preservation**: `manage` allows the trustee to rebalance assets but enforces value preservation and self-dealing checks — a governance pattern absent from KCC-0020.

### Summary

| Feature | KCC-0020 | KCC-0012-A | KCC-0012-B | KCC-0012-C |
|---------|:---:|:---:|:---:|:---:|
| Transfer leader/delegator | ✓ | ✗ | ✗ | ✗ |
| Standard transfer | ✓ | ✗ | ✗ | ✗¹ |
| Borrowed Receive | ✓ | ✗ | ✗ | ✗ |
| Conditional release | ✗ | ✓ | ✓ | ✗ |
| Death confirmation | ✗ | ✓ | ✓ | ✗ |
| Challenge delay | ✗ | ✓ | ✓ | ✗ |
| Executor distribution | ✗ | ✗ | ✓ | ✗ |
| Bonded contest | ✗ | ✗ | ✓ | ✗ |
| Schedule-based vesting | ✗ | ✗ | ✗ | ✓ |
| Trustee management | ✗ | ✗ | ✗ | ✓ |
| Descriptor | ✓ | ✓ | ✓ | ✓ |
| Extended digest | ✓ | ✓ | ✓ | ✓ |

---

## Profiles

Wallets, indexers, and DEXes detect testamentary token behavior from the covenant descriptor prefix:

| Profile | Detection | Entrypoints |
|---------|-----------|-------------|
| **Inheritance** | Descriptor matches KCC0012A | set_heir, heartbeat, confirm_death, claim |
| **Will** | Descriptor matches KCC0012B | set_beneficiaries, confirm_death, distribute, contest, resolve |
| **Trust** | Descriptor matches KCC0012C | settle, manage, distribute, replace_trustee, enforce, resolve_enforcement, terminate |

A wallet displaying an Inheritance token shows:
- Current owner and heir
- Death confirmation method (Oracle / Social N-of-M / Inactivity)
- Last heartbeat block and inactivity threshold
- Status: Active / Deceased (N blocks until claimable) / Claimed

A wallet displaying a Will token shows:
- Testator, executor, and notary
- Beneficiary count and total distribution progress
- Active contests (if any)
- Status: Draft / Active / Deceased / Distributing / Distributed / Contested

A wallet displaying a Trust token shows:
- Settlor, trustee, and notary
- Beneficiary count, schedule count
- Last distribution block, next distribution block
- End date or "Perpetual"
- Status: Unsettled / Active / Terminated

---

## Rules

### Standard A — Inheritance

1. `owner` and `heir` must be distinct, non-zero pubkey hashes.
2. `death_method` may be changed by subsequent `set_heir` calls while `status == ACTIVE`.
3. `last_heartbeat` must be updated at least once per `inactivity_blocks` when `death_method == INACTIVITY`. Failure to call `heartbeat` within the window allows anyone to call `confirm_death`.
4. `delay_blocks` must be ≥ 1. This is the minimum challenge window after death confirmation.
5. `confirm_death` is permissionless — any party may trigger it with valid proof.
6. For `SOCIAL` death method: guardians must sign `blake2b(owner || block_height)`, tying the confirmation to a specific block height to prevent replay across forks.
7. For `ORACLE` death method: the attestation timestamp must be within the covenant's freshness window (recommended: 1440 blocks, approximately 24 hours).
8. For `INACTIVITY` death method: `confirm_death` with empty proof succeeds when `current_block_height - last_heartbeat >= inactivity_blocks`.
9. `claim` succeeds only after `delay_blocks` from death confirmation.
10. Once `status == CLAIMED`, the covenant is terminal. No further state transitions.

### Standard B — Will

11. `testator`, `executor`, and `notary` must all be distinct, non-zero pubkey hashes.
12. Beneficiary `share_bps` must sum to exactly 10000. No beneficiary may have `share_bps == 0`.
13. `beneficiary_count` must be ≥ 1 and ≤ 32.
14. `vesting_delay` per beneficiary is relative to the death confirmation block, not the `distribute` call block.
15. `contest_bond` must be > 0. The bond amount is fixed by the testator and immutable after the will enters `ACTIVE` status.
16. `contest_duration` must be ≥ 1. Serves as the maximum contest pendency before auto-resolution.
17. Only one active contest may exist at a time (`status == CONTESTED` blocks new contests).
18. A beneficiary whose share has been distributed (bit set in `distribution_map`) may not contest.
19. Testator amendments (calling `set_beneficiaries` while `status == ACTIVE`) must not invalidate existing contest state. Active contests remain pending.
20. Auto-resolution: if `status == CONTESTED` for > `contest_duration × 2` blocks without a `resolve` call, the next transaction touching the covenant auto-resolves as `REJECTED`.
21. `DISTRIBUTED` is a terminal state. No further state transitions.

### Standard C — Trust

22. `settlor`, `trustee`, and `notary` must all be distinct, non-zero pubkey hashes.
23. Beneficiary `share_bps` must sum to exactly 10000. Exactly one beneficiary must be the residual beneficiary (`schedule_index == 0xFF`).
24. `schedule_count` must be ≥ 0 and ≤ 16.
25. `end_date == 0` indicates a perpetual trust with no automatic termination. `end_date > 0` triggers termination at that block height.
26. `manage` must preserve or increase total trust asset value (measured by oracle attestation). Value dissipation is prohibited.
27. `manage` must not transfer assets to the trustee's personal address (self-dealing check).
28. `manage` must not reduce the trust corpus below the amount needed for the next scheduled distribution.
29. `distribute` per schedule must respect `interval_blocks` — no front-running distributions.
30. `replace_trustee` by beneficiaries requires > 66% of `share_bps` in approvals. Settlor may replace unilaterally.
31. `enforce` freezes the trust (no `manage` or `distribute`) until the notary rules.
32. The minimum enforcement bond is a compile-time covenant parameter. The bond is slashed to the trustee if the complaint is rejected.
33. `terminate` distributes all remaining assets to the residual beneficiary. `TERMINATED` is terminal.

### Common

34. All state-changing entrypoints must be authorized by the caller specified in the entrypoint's caller constraint. Authorization is via standard Kaspa signature verification.
35. The descriptor must be published before any wallet or indexer can interact with the covenant.
36. Death confirmation proof data must be valid at the block height of inclusion. Replay of stale proofs across chain reorganizations is prevented by including `block_height` in signed messages.
37. Extended state (via `extended_state_digest`) is preserved across state transitions that do not explicitly modify it. Entrypoints that modify extended state must recompute `extended_state_digest`.
38. `status == CLAIMED` (Standard A), `status == DISTRIBUTED` (Standard B), and `status == TERMINATED` (Standard C) are terminal states. No entrypoint may transition out of a terminal state.

---

## Reference

The author maintains a conforming implementation of each sub-standard. This document defines the convention; an implementation demonstrates conformance.

Implementations referenced:
- KCC-0017 (Oracle Attestation Format) — for ORACLE death confirmation proofs
- KCC-0018 (Oracle Registry) — for oracle operator registration and verification
- KCC-0015 (Vesting Token Standard) — for schedule-based vesting patterns reused in Standard C
- KCC-0008 (Multi-Token Standard) — for descriptor pattern and extended digest conventions
¹ `manage` adopts positional I/O pattern but is a trust management operation, not a standard transfer.
