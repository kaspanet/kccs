# KCC-0013: Real World Asset Token Standard

| Field | Value |
|-------|-------|
| **KCC** | 0013 |
| **Category** | Asset Standard |
| **Title** | RWA Token — Tokenized Real World Assets |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |

## Abstract

A standard for tokenizing real-world assets on Kaspa. Each token represents fractional ownership of an off-chain asset — real estate, commodities, fine art, intellectual property, trade finance instruments, or carbon credits. The covenant enforces KYC-gated transfers by cross-referencing KCC-0014 soulbound identity tokens, oracle-verified net asset value (NAV) updates with rate-limited update authority, pro-rata income distribution, redemption mechanics with configurable minimum holdings and fees, and per-asset-profile extended state carrying the physical-world identifiers that anchor the token to its underlying asset.

## Motivation

Tokenizing real-world assets on a public ledger without identity gates is non-viable for regulated instruments. Issuers, custodians, and regulators require that only verified identities hold tokens representing real estate, commodities, or trade finance obligations. Existing token standards define transfer mechanics but leave KYC, NAV tracking, income distribution, redemption rights, and asset verification to off-chain systems with no covenant-enforceable guarantees. This standard bakes those guarantees into the covenant layer — a holder cannot receive tokens without a valid KCC-0014 soulbound credential, NAV is only updatable by the designated oracle at a configured minimum interval, income flows pro-rata to all holders when the custodian invokes `distribute_income`, and redemption burns tokens while preserving NAV integrity. Six asset profiles carry the physical-world identifiers (title references, warehouse receipts, provenance hashes, registration IDs, invoice hashes, serial numbers) that make the token legally and operationally anchored to its underlying asset.

## Specification

### State Layout

Every KCC-0013 covenant state begins with the standard KCC-0020 header, followed by an extended digest that commits to the RWA-specific data below. The standard header is identical to KCC-0008:

```
offset  size    field           encoding
0       8       token_id        uint64, big-endian
8       1       token_kind      byte
9       1       flags           byte
10      32      owner_id        bytes32
42      8       amount          uint64, big-endian
50      64      metadata_uri    padded bytes64, UTF-8
114     32      extended_digest bytes32
```

Total: 146 bytes of standard header.

**token_kind** for KCC-0013 is always `FUNGIBLE = 0x00`. All RWA tokens represent fractional ownership with fungible shares. Non-fungible redemption (e.g. single-token art) uses `token_kind = NON_FUNGIBLE = 0x01` with the same extended state layout.

**flags** bitfield:

```
BIT_FROZEN  = 0x01  // all transfers blocked (regulatory)
BIT_MINTED  = 0x02  // token_id has been fully minted
BIT_BURNED  = 0x04  // token_id has been burned (terminal)
BIT_REDEEMED = 0x08 // this specific UTXO was redeemed
```

**extended_digest** commits to the RWA extended state below. Computed as:

```
extended_digest = blake2b(encode(rwa_extended_state))
```

#### RWA Extended State

The following is the canonical extended state for every KCC-0013 token. It is hashed into `extended_digest` and is shared across all holder UTXOs for the same `token_id`:

```
offset  size    field               encoding
0       2       asset_profile       uint16, big-endian
2       64      asset_description   padded bytes64, UTF-8
66      64      jurisdiction         padded bytes64, UTF-8
130     32      custodian_id        bytes32
162     32      oracle_id           bytes32
194     32      kyc_issuer_id       bytes32
226     8       total_supply        uint64, big-endian
234     8       nav_per_token       uint64, big-endian (value in cents)
242     8       nav_updated_at      uint64, unix timestamp (seconds)
250     8       nav_update_interval uint64, seconds (minimum between oracle updates)
258     1       status              byte
259     1       flags_ext           byte
260     8       income_pool         uint64, big-endian
268     8       last_distribution   uint64, unix timestamp (seconds)
276     8       min_holding         uint64, big-endian (minimum tokens required for redemption)
284     8       redemption_fee_bps  uint64, big-endian (basis points, 100 = 1%)
292     32      profile_data_digest bytes32
```

Total extended state: 324 bytes.

**asset_profile** values:

```
REAL_ESTATE           = 0x0001
COMMODITIES           = 0x0002
FINE_ART              = 0x0003
INTELLECTUAL_PROPERTY = 0x0004
TRADE_FINANCE         = 0x0005
CARBON_CREDITS        = 0x0006
```

**status** values:

```
ACTIVE    = 0x00  // normal operation
FROZEN    = 0x01  // transfers blocked (regulatory)
REDEEMED  = 0x02  // all tokens redeemed, terminal
DEFAULTED = 0x03  // underlying asset impaired
```

**flags_ext** bitfield:

```
BIT_INCOME_ENABLED   = 0x01  // income distribution is active
BIT_REDEMPTION_OPEN  = 0x02  // redemption window is open
BIT_NAV_FINAL        = 0x04  // NAV is final (no further updates)
BIT_CUSTODIAN_LOCKED = 0x08  // custodian cannot be changed
BIT_ORACLE_LOCKED    = 0x10  // oracle cannot be changed
```

**profile_data_digest** commits to the per-profile extended state. Computed as:

```
profile_data_digest = blake2b(encode(profile_extended_state))
```

The per-profile extended state is immutable after minting.

#### Per-Profile Extended State

##### Real Estate (profile = 0x0001)

```
offset  size    field           encoding
0       128     address_bytes   padded bytes128, UTF-8
128     64      title_ref       padded bytes64, UTF-8
192     8       sq_meters       uint64, big-endian
200     4       year_built      uint32, big-endian
204     8       land_value      uint64, big-endian (cents)
212     8       structure_value uint64, big-endian (cents)
220     32      geo_hash        bytes32
```

Total: 252 bytes.

Income: rental distributions. Redemption: majority holder (>50% of supply) may force sale; proceeds distributed pro-rata.

##### Commodities (profile = 0x0002)

```
offset  size    field               encoding
0       64      warehouse_id        padded bytes64, UTF-8
64      32      grade               padded bytes32, UTF-8
96      8       weight_kg           uint64, big-endian
104     32      warehouse_receipt   bytes32
136     32      location_code       padded bytes32, UTF-8
168     8       purity_bps          uint64, big-endian (basis points, 10000 = 100%)
176     8       storage_fee_daily   uint64, big-endian (cents)
```

Total: 184 bytes.

Income: storage rebates. Redemption: physical delivery — holder calls `redeem`, custodian arranges delivery of `amount / total_supply × weight_kg` from warehouse.

##### Fine Art (profile = 0x0003)

```
offset  size    field               encoding
0       64      artist              padded bytes64, UTF-8
64      32      medium              padded bytes32, UTF-8
96      64      provenance_hash     bytes64
160     32      dimensions_cm       bytes32 (width/height/depth as three uint16 + padding)
192     8       year_created        uint64, big-endian
200     64      certificate_ref     padded bytes64, UTF-8
```

Total: 264 bytes.

Income: exhibition fees. Redemption: when `token_kind == NON_FUNGIBLE`, single-token holder may redeem for full physical ownership; when fungible, redemption follows pro-rata rules.

##### Intellectual Property (profile = 0x0004)

```
offset  size    field               encoding
0       32      ip_type             padded bytes32, UTF-8
32      64      registration_id     padded bytes64, UTF-8
96      32      territory           padded bytes32, UTF-8 (ISO 3166-1 alpha-2 codes, space-separated)
128     8       expiry              uint64, unix timestamp (seconds)
136     8       royalty_rate_bps    uint64, big-endian (basis points)
144     32      licensor_id         bytes32
```

Total: 176 bytes.

Income: royalty distributions. Redemption: license transfer — holder calls `redeem` to receive a license assignment from the custodian.

##### Trade Finance (profile = 0x0005)

```
offset  size    field               encoding
0       32      debtor_id           bytes32
32      8       face_value          uint64, big-endian (cents)
40      8       due_date            uint64, unix timestamp (seconds)
48      32      invoice_hash        bytes32
80      32      obligor_id          bytes32
112     8       discount_rate_bps   uint64, big-endian (basis points)
120     8       advance_rate_bps    uint64, big-endian (basis points)
```

Total: 128 bytes.

Income: discount accretion — the token value converges to `face_value` at `due_date`. Redemption: at maturity, custodian collects from debtor and distributes pro-rata; holders may call `redeem` after `due_date`.

##### Carbon Credits (profile = 0x0006)

```
offset  size    field               encoding
0       32      registry_id         padded bytes32, UTF-8
32      8       vintage_year        uint64, big-endian
40      32      project_type        padded bytes32, UTF-8
72      64      serial_number       padded bytes64, UTF-8
136     32      verification_body   bytes32
168     8       co2_tonnes          uint64, big-endian
176     1       retired             byte (0x00 = active, 0x01 = retired)
```

Total: 177 bytes.

No income. Redemption: retire credit — holder calls `redeem` to retire `amount / total_supply × co2_tonnes`; sets `retired = 0x01` when all credits retired.

### Core Entrypoints

#### mint

```
mint(
    uint64  token_id,
    byte    token_kind,
    uint64  amount,
    bytes64 metadata_uri,
    bytes   rwa_extended_state,     // serialized RWA extended state (324 bytes)
    bytes   profile_extended_state  // serialized per-profile state (variable length)
)
```

Creates RWA token supply backed by a verified off-chain asset. Caller must be the covenant owner (issuer). Rules:

1. `token_id` must not already exist in the covenant state.
2. `asset_profile` must be one of the defined values (0x0001–0x0006).
3. `profile_extended_state` length must match the expected size for `asset_profile` (see per-profile layouts above).
4. `kyc_issuer_id` must reference a known KCC-0014 issuer.
5. `oracle_id` and `custodian_id` must be valid, non-zero addresses.
6. `total_supply` is set to `amount` (initial mint).
7. `nav_per_token` is set from an oracle attestation provided at mint time (embedded in `rwa_extended_state`).
8. `nav_updated_at` is set to the block timestamp.
9. `status` is set to `ACTIVE (0x00)`.
10. `profile_data_digest` is computed as `blake2b(encode(profile_extended_state))`.
11. On success, the standard header is populated with `flags = BIT_MINTED` and the covenant owner as initial `owner_id`.

#### transfer

```
transfer(
    State[] next_states,        // successor states, ordered by covenant output index
    Sig[]   signatures,         // authorization signatures, positional
    byte[]  witnesses,          // per-input metadata
    bytes32 kyc_proof_input     // reference to KCC-0014 KYC token UTXO for recipient
)
```

`transfer` is invoked by the first covenant input as the leader entrypoint. It validates the complete state transition and enforces KYC gating. Remaining covenant inputs invoke `transfer_delegator` (no input data).

Rules enforced:

1. For each `token_id` in consumed states: `sum(prev_amounts) == sum(next_amounts)` — no implicit minting or burning.
2. `token_id` and `token_kind` are immutable for each consumed covenant state.
3. `BIT_FROZEN` must not be set on any consumed state.
4. `BIT_BURNED` must not be set on any consumed state.
5. `status` in extended state must be `ACTIVE (0x00)`.
6. For each consumed input where `witnesses[i] != BORROWED_RECEIVE`: `signatures[i]` must be a valid signature over the transaction sighash by the owner identified by `owner_id`.
7. **KYC enforcement** (see Section: KYC Enforcement) applies to every recipient whose `amount` increases in the successor state.

#### transfer_delegator

```
transfer_delegator()
```

Invoked by every non-leader covenant input. Delegates to the leader's `transfer` entrypoint. Enforces that at least one input invoked `transfer` as leader.

#### distribute_income

```
distribute_income(
    uint64  token_id,
    uint64  amount,
    State[] next_states,
    Sig[]   signatures
)
```

Distributes income from the custodian to all holders pro-rata. Caller must be the `custodian_id` for the token. Rules:

1. `status` must be `ACTIVE (0x00)`.
2. `BIT_INCOME_ENABLED` must be set in `flags_ext`.
3. `amount` is added to `income_pool` in the extended state.
4. For each holder UTXO: the holder's balance increases by `(holder_amount / total_supply) × amount`, rounded down. Remainder stays in `income_pool`.
5. `last_distribution` is set to the block timestamp.
6. `extended_digest` is recomputed to reflect the updated `income_pool` and `last_distribution`.

#### redeem

```
redeem(
    uint64  token_id,
    uint64  amount,
    bytes32 destination         // off-chain destination identifier for asset delivery
)
```

Holder burns tokens and claims the underlying asset. Caller must hold ≥ `amount` tokens. Rules:

1. `status` must be `ACTIVE (0x00)`.
2. `BIT_REDEMPTION_OPEN` must be set in `flags_ext`.
3. `amount` must be ≥ `min_holding` (unless redeeming entire balance).
4. A redemption fee of `amount × redemption_fee_bps / 10000` is deducted and sent to the custodian.
5. The net redeemed `amount` is burned: `total_supply` decreases, holder's balance decreases.
6. If `total_supply` reaches 0 after redemption: `status` is set to `REDEEMED (0x02)`.
7. `nav_per_token` is recalculated: `new_nav = (total_supply_old × nav_per_token - amount × nav_per_token) / total_supply_new`.
8. The `destination` parameter is emitted as an event for the custodian to coordinate off-chain delivery.
9. For non-fungible tokens (`token_kind == NON_FUNGIBLE`): `amount` is ignored; the entire token is redeemed.

#### verify_asset

```
verify_asset(
    uint64  token_id,
    uint64  new_nav_per_token,
    bytes   oracle_attestation   // oracle signature or data payload
)
```

Updates the net asset value of the underlying asset. Caller must be the `oracle_id` for the token. Rules:

1. `status` must be `ACTIVE (0x00)`.
2. `BIT_NAV_FINAL` must not be set in `flags_ext`.
3. `block.timestamp - nav_updated_at` must be ≥ `nav_update_interval` (rate-limited).
4. `oracle_attestation` must be a valid signature from `oracle_id` over `(token_id, new_nav_per_token, block.timestamp)`.
5. `new_nav_per_token` must be > 0.
6. On success: `nav_per_token` is updated, `nav_updated_at` is set to `block.timestamp`, `extended_digest` is recomputed.

#### freeze / unfreeze

```
freeze(uint64 token_id)
unfreeze(uint64 token_id)
```

Pauses or resumes all transfers for regulatory compliance. Caller must be the `custodian_id`. Rules:

1. `freeze`: sets `status` to `FROZEN (0x01)`. All transfers are blocked. `distribute_income` and `redeem` are also blocked.
2. `unfreeze`: restores `status` to `ACTIVE (0x00)`. Normal operation resumes.
3. `verify_asset` (oracle NAV updates) remain permitted even while frozen.

#### update_custodian

```
update_custodian(
    uint64  token_id,
    bytes32 new_custodian_id
)
```

Transfers the custodian role. Caller must be the current `custodian_id`. Rules:

1. `BIT_CUSTODIAN_LOCKED` must not be set in `flags_ext`.
2. `new_custodian_id` must be non-zero.
3. `custodian_id` is updated in extended state; `extended_digest` is recomputed.

#### update_oracle

```
update_oracle(
    uint64  token_id,
    bytes32 new_oracle_id
)
```

Transfers the oracle designation. Caller must be the current `oracle_id`. Rules:

1. `BIT_ORACLE_LOCKED` must not be set in `flags_ext`.
2. `new_oracle_id` must be non-zero.
3. `oracle_id` is updated in extended state; `extended_digest` is recomputed.

#### set_flags

```
set_flags(
    uint64 token_id,
    byte   flags_ext_mask,     // bits to set
    byte   flags_ext_clear     // bits to clear
)
```

Configures extended flags. Caller must be the `custodian_id`. Rules:

1. `BIT_INCOME_ENABLED`, `BIT_REDEMPTION_OPEN`, `BIT_NAV_FINAL`, `BIT_CUSTODIAN_LOCKED`, `BIT_ORACLE_LOCKED` may be set or cleared.
2. `BIT_CUSTODIAN_LOCKED` and `BIT_ORACLE_LOCKED` are irreversible once set — they cannot be cleared.
3. `BIT_NAV_FINAL` is irreversible once set — it cannot be cleared.

### KYC Enforcement

KCC-0013 enforces identity verification at the covenant level by cross-referencing KCC-0014 Soulbound Tokens. Before any transfer can increase a recipient's balance, the covenant verifies that the recipient holds a valid KYC credential.

#### Verification Flow

1. The `transfer` entrypoint receives `kyc_proof_input`, which is a reference to a KCC-0014 soulbound token UTXO consumed in the same transaction.
2. The covenant reads the KCC-0014 state from that UTXO and validates:
   a. `token_type == KYC` — the soulbound token represents a KYC credential.
   b. `status == ACTIVE` — the credential has not been revoked, expired, or burned.
   c. `issuer == kyc_issuer_id` — the credential was issued by the approved KYC provider for this RWA token.
   d. `expires_at == 0 OR expires_at > block.timestamp` — the credential is not expired (0 = permanent).
   e. `holder == recipient_owner_id` — the credential belongs to the recipient (i.e., is bound to the same identity that will hold the RWA tokens).
3. If all conditions pass, the transfer proceeds. If any condition fails, the transfer reverts.

#### Multiple Recipients

When a single `transfer` call has multiple recipients (multiple successor states with different `owner_id` values whose `amount` increased), each distinct recipient must have a corresponding KCC-0014 KYC token referenced in the transaction inputs. The covenant iterates over all successor states and verifies KYC for every recipient whose balance increases.

#### Self-Transfer and Custodian Exemption

- **Self-transfer**: When sender == recipient (balance moves between UTXOs of the same owner), no KYC check is required — the owner is already verified.
- **Borrowed Receive** (`witnesses[i] == 0xFF`): Preserves `owner_id` — no new recipient, so no KYC check.
- **Custodian distributions**: `distribute_income` increases existing holder balances without changing `owner_id` — no KYC check needed.

#### KYC Issuer Governance

The `kyc_issuer_id` is set at mint time and is immutable thereafter. Changing the KYC provider requires minting a new `token_id`. This ensures that holders cannot be retroactively subjected to a different KYC regime.

### NAV Specification

Net Asset Value (`nav_per_token`) represents the value of one token in the smallest currency unit (cents, or the equivalent for the jurisdiction). It is the covenant-enforceable link between on-chain token price and off-chain asset value.

#### Update Authority

Only the `oracle_id` may update `nav_per_token` via the `verify_asset` entrypoint. The oracle must be an independent valuation provider — typically a licensed appraiser, audit firm, or data feed operator.

#### Update Frequency

`nav_update_interval` defines the minimum seconds between NAV updates. Typical values:

| Asset Profile | Recommended Interval |
|---------------|---------------------|
| Real Estate | 7,776,000 (90 days) |
| Commodities | 86,400 (1 day) |
| Fine Art | 7,776,000 (90 days) |
| Intellectual Property | 2,592,000 (30 days) |
| Trade Finance | 86,400 (1 day) |
| Carbon Credits | 86,400 (1 day) |

#### Attestation Format

The `oracle_attestation` in `verify_asset` must be a signature from `oracle_id` over:

```
blake2b(token_id || new_nav_per_token || timestamp || chain_id)
```

Where `timestamp` is the current block timestamp and `chain_id` prevents cross-chain replay. The covenant verifies this signature against `oracle_id` before accepting the update.

#### NAV Invariant

At all times, for every active RWA token:

```
total_supply × nav_per_token = audited_asset_value
```

The oracle attestation certifies that the off-chain asset value equals `total_supply × new_nav_per_token`. The oracle is responsible for sourcing valuation data (appraisals, market prices, audit reports) and ensuring the invariant holds.

#### NAV on Redemption

When tokens are redeemed via `redeem`, the NAV is adjusted proportionally:

```
nav_per_token_new = nav_per_token_old  // NAV per token is unchanged by redemption
total_supply_new = total_supply_old - redeemed_amount
// Total NAV: total_supply_new × nav_per_token
```

The underlying asset value represented by the redeemed tokens is delivered to the redeeming holder off-chain by the custodian.

### Income Distribution

Income flows from the underlying asset (rent, dividends, royalties, storage rebates, discount accretion) to token holders through the `distribute_income` entrypoint.

#### Distribution Mechanics

1. The custodian calls `distribute_income(token_id, amount, ...)`.
2. The covenant computes each holder's pro-rata share:
   ```
   holder_share = (holder_amount / total_supply) × amount
   ```
   Division is integer division; any remainder accumulates in `income_pool` for the next distribution.
3. Each holder's `amount` in their UTXO increases by `holder_share`.
4. The `income_pool` is decremented by the distributed amount (minus remainder), and `last_distribution` is updated.
5. The custodian provides `next_states` reflecting the updated holder balances.

#### Authorization

The custodian must sign the transaction. The covenant verifies the caller is `custodian_id` from the extended state. No holder signatures are required — income distribution is a push operation (custodian pushes value to holders).

#### Income Pool

The `income_pool` field accumulates income between distributions. The custodian may deposit income at any time by calling `distribute_income`. There is no minimum distribution threshold — the custodian chooses when to distribute based on operational efficiency (gas costs vs. holder benefit).

### Descriptor

Each KCC-0013 covenant must publish a descriptor:

```
KCC0013Descriptor {
    prefix: bytes                   // covenant script bytes before mutable state
    suffix: bytes                   // covenant script bytes after mutable state
    token_ids: uint64[]             // token_ids managed by this deployment
    asset_profiles: (uint64, uint16)[]  // (token_id, asset_profile) pairs
    kyc_issuer_id: bytes32          // approved KCC-0014 issuer for KYC
    extensions: ExtensionId[]       // supported KCC-0020 extensions
}
```

The descriptor allows wallets, DEXes, and indexers to identify the covenant, decode its state, determine which asset profiles it carries, and locate the KYC issuer for compliance checks.

### Witness Semantics

Witness values for the `transfer` entrypoint:

```
BORROWED_RECEIVE   = 0xFF  // KCC-0020 Borrowed Receive (exempts authorization + KYC)
STANDARD_TRANSFER  = 0x00  // normal signed transfer with KYC enforcement
```

For `transfer_delegator`, witnesses are not used.

For `mint`, `redeem`, `distribute_income`, `verify_asset`, `freeze`, `unfreeze`, `update_custodian`, `update_oracle`, and `set_flags`, the caller provides `signatures[i]` authorizing the state transition.

### KCC-0020 Alignment

This standard adopts the following from KCC-0020:

- **Transfer interface**: leader/delegator pattern with `transfer(State[], Sig[], byte[])` entrypoint signature
- **Positional input/output pairing**: consumed state at index `i` corresponds to successor state at index `i`
- **Witness semantics**: positional witness values determine authorization mode
- **Borrowed Receive**: `witnesses[i] == 0xFF` exempts input from owner authorization while preserving `owner_id`, `token_kind`, `extended_digest`
- **Extended state**: opaque `extended_digest` commitment via blake2b
- **Descriptor**: `prefix/suffix` covenant script bytes for template identification

Where this standard extends KCC-0020:

- **KYC gating**: every transfer validates recipient identity against KCC-0014 soulbound tokens with issuer, status, and expiry checks
- **NAV tracking**: oracle-updated `nav_per_token` with rate-limited, attested updates and an auditable NAV invariant
- **Income distribution**: custodian-pushed pro-rata income with `income_pool` accumulation
- **Redemption mechanics**: holder-initiated token burn with configurable minimum holdings, redemption fees, NAV adjustment, and off-chain delivery coordination
- **Asset profiles**: six per-profile extended state layouts carrying physical-world identifiers (title references, warehouse receipts, provenance hashes, registration IDs, invoice hashes, serial numbers)
- **Custodian/oracle roles**: designated update authorities for NAV, income, and compliance actions with optional role locking

## Encoding

This standard specifies the semantic interface, extended state layout, KYC enforcement flow, NAV update protocol, income distribution mechanics, redemption process, and per-profile state encoding for RWA token covenants. For the byte-level encoding of the transfer leader/delegator pattern, witness positional semantics, Borrowed Receive extension, and standard state header, see KCC-0020 (Fungible Token Covenant Specification by Manyfest, Michael Sutton, and IzioDev). For the soulbound identity token standard consumed by KYC enforcement, see KCC-0014.

## Profiles

Wallets and DEXes detect RWA token behavior from `asset_profile`:

| Profile | Detection | Income | Redemption |
|---------|-----------|--------|------------|
| **Real Estate** | `asset_profile = 0x0001` | Rental distributions | Majority holder forces sale; proceeds pro-rata |
| **Commodities** | `asset_profile = 0x0002` | Storage rebates | Physical delivery from warehouse |
| **Fine Art** | `asset_profile = 0x0003` | Exhibition fees | Single-token: full ownership; fungible: pro-rata |
| **Intellectual Property** | `asset_profile = 0x0004` | Royalties | License assignment from custodian |
| **Trade Finance** | `asset_profile = 0x0005` | Discount accretion to face value | Collect from debtor at maturity |
| **Carbon Credits** | `asset_profile = 0x0006` | None | Retire credit; sets `retired = 0x01` |

A single deployment may carry multiple `token_id` values with different asset profiles.

## Rules

1. `token_id` must be unique and immutable within a deployment.
2. `asset_profile` is immutable for each minted `token_id`.
3. `kyc_issuer_id` is immutable for each minted `token_id` — changing KYC provider requires a new `token_id`.
4. Every transfer that increases a recipient's balance must verify that the recipient holds a valid KCC-0014 soulbound KYC token from `kyc_issuer_id` with `status == ACTIVE` and `expires_at` in the future (or 0 for permanent).
5. Only `oracle_id` may call `verify_asset`; updates are rate-limited by `nav_update_interval`.
6. `total_supply × nav_per_token` must equal the audited off-chain asset value at the time of each `verify_asset` call — the oracle attests to this invariant.
7. The custodian (`custodian_id`) cannot hold RWA tokens for any `token_id` they custody — enforced by checking `owner_id != custodian_id` on every state transition.
8. `distribute_income` must distribute pro-rata: each holder receives `(holder_amount / total_supply) × amount`; remainder stays in `income_pool`.
9. `redeem` fails if `amount < min_holding` (unless redeeming the holder's entire balance).
10. `redeem` deducts `amount × redemption_fee_bps / 10000` as a custodian fee before burning.
11. `BIT_CUSTODIAN_LOCKED` and `BIT_ORACLE_LOCKED` are irreversible once set.
12. `BIT_NAV_FINAL` is irreversible once set — no further NAV updates permitted.
13. All state-changing entrypoints (transfer, mint, redeem, distribute_income) fail while `status == FROZEN`. NAV updates (`verify_asset`) remain permitted.
14. `status == REDEEMED` is terminal — all tokens have been redeemed, no further transitions.
15. `profile_data_digest` must match `blake2b(encode(profile_extended_state))` — the per-profile state is immutable after mint.
16. The descriptor must be published before any wallet or indexer can interact with the covenant.

## Reference

The author maintains a conforming implementation. This document defines the convention; an implementation demonstrates conformance. See also:

- **KCC-0008**: Multi-Token Standard — the base standard header and token_kind convention
- **KCC-0014**: Soulbound Token Standard — the KYC credential format consumed by this standard
- **KCC-0020**: Fungible Token Covenant Specification — the byte-level transfer encoding adopted by this standard (Manyfest, Michael Sutton, IzioDev)