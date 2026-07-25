# KCC-0009: Governed Token Standard

| Field | Value |
|-------|-------|
| **KCC** | 0009 |
| **Category** | Asset Standard |
| **Title** | Governed Token — Multi-Party Approval for Transfers |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |
| **Updated** | 2026-07-25 |

## Abstract

A token standard where every transfer from the covenant treasury requires approval from N-of-M authorized governors. No single party can move funds — governance lives in the token covenant itself, not in an external wallet wrapper. Proposals proceed through a lifecycle of _propose_, _second_, and _execute_ with a mandatory execution delay and optional veto power. This standard fills the gap between raw multisig wallets (which control entire accounts) and conventional token standards (which lack multi-party governance).

## Motivation

Existing multisig wallets control entire accounts — all assets, all operations. A governed token controls the asset itself. Four critical differences:

| | Multisig Wallet | Governed Token |
|---|---|---|
| **Control scope** | All assets in wallet | This token only |
| **Audit trail** | Wallet-level transactions | Per-proposal on-chain records |
| **Recovery** | Key rotation (all-or-nothing) | Governor set replacement requires quorum |
| **Composability** | None — wallet-level gating | Covenant-composable with commerce and DEX contracts |

Concrete use cases:

- **DAO treasury**: 5-of-9 signers to deploy capital, with 48-hour execution delay for community review.
- **Corporate account**: CEO proposes, CFO seconds, funds move after mandatory delay.
- **Escrow**: buyer, seller, arbitrator — 2-of-3 to release funds.
- **Inheritance fund**: 3-of-5 heirs must agree to access.

## Specification

### State Layout

A KCC-0009 covenant manages two state segments: a **Config segment** that holds governance parameters and the treasury, and **Proposal segments** that track pending transfer or governance actions.

#### Config State

Every KCC-0009 covenant deployment produces exactly one config UTXO. Its state begins with the following fields, in this order and encoding:

```
offset  size    field               encoding
0       1       num_governors       uint8
1       1       quorum              uint8
2       1       flags               byte
3       5       reserved            bytes (zero-filled)
8       8       proposal_timeout    uint64, big-endian
16      8       execution_delay     uint64, big-endian
24      8       next_proposal_id    uint64, big-endian
32      64      metadata_uri        padded bytes64, UTF-8
96      8       total_supply        uint64, big-endian
104     8       treasury_balance    uint64, big-endian
```

Total fixed header: 112 bytes.

Following the fixed header, the governor list is packed as N consecutive `bytes32` entries:

```
offset          size    field
112             32      governors[0]        bytes32
112 + 32        32      governors[1]        bytes32
...
112 + (N-1)*32  32      governors[N-1]      bytes32
```

Total config state size: `112 + N * 32` bytes.

**flags** bitfield:

```
BIT_VETO_POWER    = 0x01  // single governor can veto a proposal
BIT_FROZEN        = 0x02  // all proposals blocked (emergency pause)
BIT_INITIALIZED   = 0x04  // config has been deployed and governors set
```

**metadata_uri** specifies an off-chain metadata resource for the token (name, ticker, decimals, governance charter). See forthcoming KCC-0021 (Knitser) for canonical metadata layout.

#### Proposal State

Each active proposal is a separate covenant UTXO. Multiple proposals may coexist. The proposal state layout:

```
offset  size    field               encoding
0       8       proposal_id         uint64, big-endian
8       1       proposal_type       byte
9       32      proposer            bytes32
41      32      recipient           bytes32
73      8       amount              uint64, big-endian
81      8       governor_index      uint64, big-endian
89      32      new_governor        bytes32
121     32      reason_hash         bytes32
153     8       created_block       uint64, big-endian
161     8       expires_block       uint64, big-endian
169     8       executes_after      uint64, big-endian
177     2       approval_count      uint16, big-endian
179     2       veto_count          uint16, big-endian
181     1       status              byte
```

Total fixed header: 182 bytes.

Following the fixed header, the approvals bitmap tracks which governors have voted:

```
offset          size    field
182             ceil(N/8)  approvals_bitmap   bytes
```

Each bit position `i` corresponds to `governors[i]`. Bit = 1 means that governor has approved. Bit = 0 means not yet voted.

Total proposal state size: `182 + ceil(N/8)` bytes.

**proposal_type** values:

```
TRANSFER          = 0x00  // move tokens from treasury to recipient
REPLACE_GOVERNOR  = 0x01  // swap a governor at governor_index for new_governor
```

**status** values:

```
PENDING    = 0x00  // open for seconds and vetoes
EXECUTED   = 0x01  // proposal has been executed (terminal)
CANCELLED  = 0x02  // withdrawn by proposer (terminal)
VETOED     = 0x03  // blocked by veto (terminal)
EXPIRED    = 0x04  // passed expires_block without reaching quorum (terminal)
```

**Field usage by proposal_type:**

| Field | TRANSFER | REPLACE_GOVERNOR |
|-------|----------|-------------------|
| `recipient` | Token recipient address | Unused (set to zero) |
| `amount` | Token amount to transfer | Unused (set to zero) |
| `governor_index` | Unused (set to zero) | Index of governor to replace |
| `new_governor` | Unused (set to zero) | New governor pubkey hash |

### Entrypoints

#### propose

```
propose(
    byte    proposal_type,
    bytes32 recipient,
    uint64  amount,
    uint64  governor_index,
    bytes32 new_governor,
    bytes32 reason_hash
)
```

Creates a new proposal. Caller must be a governor (identified by `signatures[0]` matching an entry in the governor list). Rules enforced:

1. Caller's pubkey hash must appear in `governors[]`.
2. `BIT_FROZEN` must not be set on config state.
3. If `proposal_type == TRANSFER`: `amount` must be > 0 and ≤ `treasury_balance`. `recipient` must be non-zero.
4. If `proposal_type == REPLACE_GOVERNOR`: `governor_index` must be < `num_governors`. `new_governor` must be non-zero and must not already be in the governor list.
5. `reason_hash` should commit to an off-chain description of the proposal's purpose.
6. On success, a new proposal UTXO is created with:
   - `proposal_id = next_proposal_id` (config's `next_proposal_id` is then incremented)
   - `proposer` set to caller
   - `created_block` set to current block height
   - `expires_block = created_block + proposal_timeout`
   - `executes_after = 0` (set on first second that reaches quorum)
   - `approval_count = 1` (proposer auto-approves)
   - `approvals_bitmap[proposer_index] = 1`
   - `status = PENDING`

#### second

```
second(
    uint64 proposal_id
)
```

Records a governor's approval for a pending proposal. Caller must be a governor. Rules enforced:

1. Proposal must exist with `status == PENDING`.
2. Current block height must be < `expires_block`.
3. Caller must be in `governors[]`.
4. Caller must not be the proposer (`proposer` field).
5. Caller must not have already approved (`approvals_bitmap[caller_index] == 0`).
6. On success:
   - `approval_count` incremented.
   - `approvals_bitmap[caller_index]` set to 1.
   - If `approval_count` reaches `quorum` for the first time: `executes_after = current_block + execution_delay`.
   - If `execution_delay == 0`: proposal transitions directly to `EXECUTED` and transfer occurs immediately (see `execute`).

#### veto

```
veto(
    uint64 proposal_id
)
```

Blocks a proposal. Caller must be a governor. Only available when `BIT_VETO_POWER` is set. Rules enforced:

1. `BIT_VETO_POWER` must be set in config flags.
2. Proposal must exist with `status == PENDING`.
3. Caller must be in `governors[]`.
4. Caller must not be the proposer.
5. On success: `status = VETOED`. Proposal UTXO is terminal.

Note: a single veto kills the proposal regardless of `quorum`. This is the "single-party block" semantics described by the `BIT_VETO_POWER` flag.

#### execute

```
execute(
    uint64 proposal_id
)
```

Executes a proposal that has reached quorum and passed its execution delay. Callable by anyone (not just governors). Rules enforced:

1. Proposal must exist with `status == PENDING`.
2. `approval_count >= quorum`.
3. Current block height ≥ `executes_after` (execution delay has elapsed).
4. Current block height < `expires_block`.
5. If `proposal_type == TRANSFER`:
   - `treasury_balance >= amount`.
   - On success: `treasury_balance -= amount`. Tokens are transferred to `recipient` via a new transaction output. `status = EXECUTED`.
6. If `proposal_type == REPLACE_GOVERNOR`:
   - On success: `governors[governor_index] = new_governor`. `status = EXECUTED`.
7. Proposal UTXO transitions to terminal state.

#### cancel

```
cancel(
    uint64 proposal_id
)
```

Withdraws a pending proposal. Caller must be the original proposer. Rules enforced:

1. Proposal must exist with `status == PENDING`.
2. Caller must match `proposer`.
3. On success: `status = CANCELLED`. Proposal UTXO is terminal.

#### replace_governor

```
replace_governor(
    uint64 governor_index,
    bytes32 new_governor,
    bytes32 reason_hash
)
```

Convenience entrypoint that combines `propose(REPLACE_GOVERNOR, ...)`. Creates a REPLACE_GOVERNOR proposal in a single call. Same rules as `propose` with `proposal_type = REPLACE_GOVERNOR`. After creation, the proposal must go through the normal `second`/`execute` lifecycle — this entrypoint does NOT bypass governance. This ensures a lost governor key does not permanently freeze the treasury; the remaining governors can replace the lost key through the standard quorum process.

#### mint

```
mint(
    uint64  amount,
    bytes32 recipient
)
```

Creates new token supply. Caller must be the covenant owner (see KCC-0001 for owner identification). Rules enforced:

1. `amount` must be > 0.
2. `BIT_FROZEN` must not be set.
3. On success: `total_supply += amount`. If `recipient` is the covenant's own treasury address: `treasury_balance += amount`. Otherwise, tokens are transferred to `recipient` in a new transaction output.

#### burn

```
burn(
    uint64 amount
)
```

Destroys tokens from the treasury. Caller must be the covenant owner. Rules enforced:

1. `amount` must be > 0 and ≤ `treasury_balance`.
2. On success: `total_supply -= amount`, `treasury_balance -= amount`.

### Descriptor

Each KCC-0009 covenant must publish a descriptor:

```
KCC0009Descriptor {
    prefix: bytes              // covenant script bytes before mutable state
    suffix: bytes              // covenant script bytes after mutable state
    num_governors: uint8       // number of governors in the set
    quorum: uint8              // approvals required for execution
    veto_power: bool           // whether BIT_VETO_POWER is set
    proposal_timeout: uint64   // blocks before proposal expiry
    execution_delay: uint64    // blocks between quorum and execution
    governor_set_digest: bytes32  // blake2b of packed governors[]
    metadata_uri: bytes64      // token metadata resource
}
```

The descriptor allows wallets and indexers to identify the covenant, decode its state, verify the governor set, and determine governance parameters without scanning proposal UTXOs.

### Witness Semantics

Witness values for each entrypoint:

```
entrypoint          witness[0] semantics
propose             governor's authorization signature
second              governor's authorization signature
veto                governor's authorization signature
execute             caller authorization (may be empty — anyone can execute)
cancel              proposer's authorization signature
replace_governor    governor's authorization signature
mint                covenant owner's authorization signature
burn                covenant owner's authorization signature
```

For `propose`, `second`, `veto`, `replace_governor`: the covenant verifies that `signatures[0]` is a valid signature over the transaction sighash by the governor identified by the caller's pubkey hash. The governor's index in `governors[]` is resolved by matching the pubkey hash.

For `execute`: authorization is optional. Any party may submit the execute transaction once quorum and delay conditions are met.

For `mint` and `burn`: standard KCC-0001 owner authorization applies.

### KCC-0020 Alignment

This standard adopts the following from KCC-0020:

| Feature | KCC-0020 | KCC-0009 |
|---------|:---:|:---:|
| Transfer leader/delegator | ✓ | ✗ |
| Standard transfer | ✓ | ✗ |
| Borrowed Receive | ✓ | ✗ |
| Positional I/O pairing | ✓ | ✗ |
| Descriptor prefix/suffix | ✓ | ✓ |
| Offset-based state layout | ✓ | ✓ |
| Big-endian encoding | ✓ | ✓ |
| Governance proposal lifecycle | ✗ | ✓ |
| Quorum-based transfer authorization | ✗ | ✓ |
| Execution delay window | ✗ | ✓ |

This standard adopts the following from KCC-0020:

- **Descriptor pattern**: `prefix/suffix` covenant script bytes for template identification, enabling wallets and indexers to recognize the covenant.
- **Metadata URI**: `metadata_uri` field (bytes64, UTF-8 padded) for off-chain token identity. See KCC-0021 for canonical layout.
- **Extended digest pattern**: config state integrity is verifiable through the descriptor's `governor_set_digest` (blake2b of governors[]), analogous to KCC-0020's `extended_state_digest`.

Where this standard diverges from KCC-0020:

- **No transfer leader/delegator pattern**: KCC-0009 does NOT use `transfer(State[], Sig[], byte[])` / `transfer_delegator()`. The standard KCC-0020 transfer flow — where a holder signs to authorize movement and inputs are paired positionally with outputs — is replaced entirely by the governance proposal lifecycle.
- **No Borrowed Receive**: the `witness == 0xFF` Borrowed Receive extension is not applicable. Every token movement requires a governance proposal that reaches quorum.
- **No positional input/output pairing**: proposals specify explicit `recipient` and `amount` rather than relying on covenant input ordering.
- **No allowance system**: approve/transfer_from from KCC-0008 are not relevant — governance replaces delegated spending.
- **Governance-gated transfers**: every transfer originates from the treasury and requires propose → second → execute (or propose → second → immediate if `execution_delay == 0`).
- **Governor set management**: governor replacement is itself a governed action (REPLACE_GOVERNOR proposal type), ensuring no single party can reconfigure the control structure.

## Encoding

### What KCC-0020 Covers

KCC-0020 defines the byte-level encoding for _holder-initiated_ token transfers. Its core mechanisms are:

- **Transfer leader/delegator pattern**: the first covenant input invokes `transfer(State[], Sig[], byte[])` as the leader; remaining inputs invoke `transfer_delegator()` with no input data, deferring to the leader's declared state transition.
- **Positional input/output pairing**: consumed state at index `i` corresponds to successor state at index `i` in the `next_states` array. This ordering is the basis for amount conservation checks.
- **Witness semantics**: positional witness values determine authorization mode — `BORROWED_RECEIVE (0xFF)` exempts an input from owner authorization (for deposits), `STANDARD_TRANSFER (0x00)` requires a valid owner signature.
- **Borrowed Receive extension**: a covenant input with `witness == 0xFF` preserves `owner_id`, `token_kind`, `metadata_uri`, and `extended_state_digest` while increasing `amount`, enabling trustless deposits into the covenant.
- **Extended state commitments**: `extended_state_digest = blake2b(encode(extended_state))` commits to covenant-specific data beyond the standard header, treated as opaque by standard transfers.

### What KCC-0009 Extends Beyond KCC-0020

KCC-0009 does **not** use the KCC-0020 transfer pattern. The governed token replaces holder-signed transfers with a **governance proposal lifecycle**:

1. **Propose**: A governor creates a proposal specifying recipient, amount, and reason. The proposal is a new covenant UTXO with the byte-level layout defined in [Proposal State](#proposal-state).
2. **Second**: Other governors add their approval by updating the proposal UTXO's `approvals_bitmap` and `approval_count`. Each governor may second exactly once.
3. **Execute**: Once `approval_count >= quorum` AND `current_block >= executes_after`, any party may trigger execution. The covenant validates all conditions and, if met, produces the transfer output and marks the proposal `EXECUTED`.
4. **Cancel / Veto**: The proposer may withdraw a pending proposal; any governor may veto (when `BIT_VETO_POWER` is set).

The byte-level encoding for KCC-0009 state is fully specified in this document's [State Layout](#state-layout) section. The encoding is self-contained — implementers do not need to reference KCC-0020 for field layout or entrypoint signatures.

### Key Architectural Differences

| Mechanism | KCC-0020 | KCC-0009 |
|-----------|----------|----------|
| Transfer initiation | Holder signature | Governor proposal |
| Authorization model | Per-transfer signature | Quorum of governors |
| State transition | Leader/delegator pattern | Proposal lifecycle UTXOs |
| Input/output pairing | Positional (index `i` ↔ `i`) | Explicit `recipient` field |
| Deposit mechanism | Borrowed Receive (0xFF) | `mint` entrypoint (owner) |
| Freeze mechanism | `BIT_FROZEN` per state | `BIT_FROZEN` on config (all proposals) |
| Recovery from lost key | Key rotation (KCC-0001) | REPLACE_GOVERNOR proposal (quorum-gated) |

## Rules

1. `num_governors` must be ≥ `quorum` at deployment. A governor set where `N < M` cannot execute proposals — the `replace_governor` path remains available to restore quorum.
2. `quorum` must be ≥ 2. Single-governor approval defeats the purpose of multi-party governance.
3. A governor may not second their own proposal. The proposer's auto-approval counts toward quorum; additional approvals must come from distinct governors.
4. A governor may second a given proposal at most once (`approvals_bitmap` enforcement).
5. Execution fails if `approval_count < quorum`, `current_block < executes_after`, `current_block >= expires_block`, or `status != PENDING`.
6. When `execution_delay == 0`, a proposal reaching quorum executes immediately within the `second` transaction — no separate `execute` call is required.
7. `replace_governor` creates a REPLACE_GOVERNOR proposal that must pass the same quorum and delay as a TRANSFER proposal. Governor replacement is itself a governed action.
8. After a successful REPLACE_GOVERNOR execution, the replaced governor's key is permanently removed. The new governor's key is active immediately for subsequent proposals.
9. If governor set size falls below quorum (due to key loss without replacement), no new proposals can execute. A pre-existing REPLACE_GOVERNOR proposal that was approved before the loss can still execute if its `executes_after` has passed.
10. `proposal_timeout` must be > 0. A value of zero would cause proposals to expire at `created_block`, making them un-secondable.
11. `execution_delay` may be zero for instant execution upon reaching quorum. Non-zero values enforce a mandatory review period.
12. When `BIT_VETO_POWER` is set, a single veto transitions the proposal to `VETOED` regardless of `approval_count`. Veto is irreversible.
13. When `BIT_FROZEN` is set, `propose`, `second`, `mint`, and `execute` all fail. Existing proposals may still be cancelled or vetoed.
14. `mint` and `burn` are owner-only (KCC-0001). They bypass governance — supply changes do not require a proposal.
15. `total_supply` and `treasury_balance` are updated atomically with each mint, burn, and execute. No intermediate state is observable.
16. The descriptor must be published before any wallet or indexer can interact with the covenant.
17. All terminal proposal statuses (`EXECUTED`, `CANCELLED`, `VETOED`, `EXPIRED`) are irreversible.

## Reference

The author maintains a conforming implementation. This document defines the convention; an implementation demonstrates conformance.

Companion standards:

- **KCC-0001**: Covenant ownership and authorization model.
- **KCC-0020**: Fungible Token Covenant — the transfer pattern that KCC-0009 replaces with governance.
- **KCC-0021**: Token metadata identity and discovery (canonical `metadata_uri` layout).
- **KCC-0008**: Multi-Token Standard — demonstrates the descriptor, state layout, and entrypoint documentation conventions adopted here.