# KCC-0019: Legal Signaling Conventions

| Field | Value |
|-------|-------|
| **KCC** | 0019 |
| **Category** | Covenant Convention |
| **Title** | Legal Signaling — consensus, conditions, offers, and redlining |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-24 |
| **Updated** | 2026-07-25 |

## Abstract

Six covenants forming the signaling layer for legal agreements on Kaspa. Unlike token standards (KCC-0008, KCC-0009, KCC-0020), signaling covenants do not transfer value — they record intent, agreement, conditions, and attestations. Together they mirror the full lifecycle of legal contract formation: **Offer** (proposal/acceptance with mirror-image rule), **Redline** (clause-level document markup), **ConditionalAccept** (cross-reference between two acceptance states), **ConsensusRecord** (multi-party fact attestation with quorum), **ConsensusSignal** (condition/breach/deferral/waiver tracking across 12 legal states), and **MultiPartyExecute** (sequential multi-signature execution with timeout).

## Motivation

Legal agreements require more than payment execution. They require offer, acceptance, counter-offer, redlining, conditional acceptance, fact attestation, and multi-party execution. Current blockchain systems handle payments; none handle the legal formation process with the precision required for enforceable contracts. Each signaling covenant maps a specific legal construct to a byte-level state machine that composes with token covenants without being a token covenant itself.

---

## Specification

---

### 1. Offer

Mirrors common law contract formation: one party proposes terms; the counterparty either accepts (mirror-image rule — acceptance must match offer exactly) or rejects. Rejection terminates the offer. Offers expire by block height.

#### 1.1 State Layout

Every Offer covenant state begins with the following fields, in this order and encoding:

```
offset  size    field               encoding
0       8       offer_id            uint64, big-endian
8       32      proposer_id         bytes32
40      32      counterparty_id     bytes32
72      1       status              byte
73      7       reserved            bytes (zero-filled)
80      8       created_block       uint64, big-endian
88      8       expires_block       uint64, big-endian
96      8       resolved_block      uint64, big-endian
104     32      terms_hash          bytes32
136     64      metadata_uri        padded bytes64, UTF-8
```

Total fixed header: 200 bytes.

**status** values:

```
PENDING   = 0x00  // offer is open for acceptance
ACCEPTED  = 0x01  // counterparty accepted (terminal)
REJECTED  = 0x02  // counterparty rejected (terminal)
EXPIRED   = 0x03  // passed expires_block without resolution (terminal)
CANCELLED = 0x04  // withdrawn by proposer before acceptance (terminal)
```

#### 1.2 State Machine

```
                    ┌─────────┐
                    │ PENDING │
                    └────┬────┘
           ┌─────────────┼─────────────────┐
           ▼             ▼                  ▼
     ┌──────────┐  ┌──────────┐     ┌─────────┐
     │ ACCEPTED │  │ REJECTED │     │ EXPIRED │
     └──────────┘  └──────────┘     └─────────┘
                               
  proposer cancels → CANCELLED (from PENDING only)
```

#### 1.3 Entrypoints

##### propose

```
propose(
    bytes32 counterparty_id,
    bytes32 terms_hash,
    uint64  expires_block,
    bytes64 metadata_uri
)
```

Creates a new offer. Caller becomes `proposer_id`. Rules enforced:

1. `counterparty_id` must be non-zero and must not equal the caller's pubkey hash.
2. `expires_block` must be > current block height.
3. `terms_hash` must be non-zero — a blake2b hash of the serialized terms document.
4. On success, a new offer UTXO is created with:
   - `offer_id` set to an incrementing covenant counter
   - `proposer_id` set to caller
   - `status = PENDING`
   - `created_block` set to current block height
   - `resolved_block = 0`

##### accept

```
accept(
    uint64 offer_id,
    bytes32 terms_hash
)
```

Accepts a pending offer. Caller must be the `counterparty_id`. Rules enforced:

1. Offer must exist with `status == PENDING`.
2. Current block height must be < `expires_block`.
3. Caller must match `counterparty_id`.
4. `terms_hash` must exactly match the offer's `terms_hash` (mirror-image rule — acceptance must be of the identical terms).
5. On success: `status = ACCEPTED`, `resolved_block = current_block`.

##### reject

```
reject(
    uint64 offer_id
)
```

Rejects a pending offer. Caller must be the `counterparty_id`. Rules enforced:

1. Offer must exist with `status == PENDING`.
2. Current block height must be < `expires_block`.
3. Caller must match `counterparty_id`.
4. On success: `status = REJECTED`, `resolved_block = current_block`.

##### cancel

```
cancel(
    uint64 offer_id
)
```

Withdraws a pending offer. Caller must be the `proposer_id`. Rules enforced:

1. Offer must exist with `status == PENDING`.
2. Caller must match `proposer_id`.
3. On success: `status = CANCELLED`, `resolved_block = current_block`.

##### expire

```
expire(
    uint64 offer_id
)
```

Marks an expired offer as terminal. Callable by anyone. Rules enforced:

1. Offer must exist with `status == PENDING`.
2. Current block height must be ≥ `expires_block`.
3. On success: `status = EXPIRED`, `resolved_block = current_block`.

#### 1.4 Descriptor

```
KCC0019OfferDescriptor {
    prefix: bytes              // covenant script bytes before mutable state
    suffix: bytes              // covenant script bytes after mutable state
    next_offer_id: uint64      // incrementing counter, next offer_id to assign
    metadata_uri: bytes64      // covenant-level metadata resource
}
```

---

### 2. Redline

Mirrors legal redlining: each party marks up a document at clause level. The redline tracks which clause was changed, what the change was, and who made it. Redlines may chain — a redline can reference a prior redline to show revision history.

#### 2.1 State Layout

```
offset  size    field               encoding
0       8       redline_id          uint64, big-endian
8       8       parent_offer_id     uint64, big-endian
16      32      author_id           bytes32
48      32      counterparty_id     bytes32
80      1       status              byte
81      1       clause_count        uint8
82      6       reserved            bytes (zero-filled)
88      8       created_block       uint64, big-endian
96      8       resolved_block      uint64, big-endian
104     8       prev_redline_id     uint64, big-endian
112     32      document_hash       bytes32
144     64      metadata_uri        padded bytes64, UTF-8
```

Total fixed header: 208 bytes.

Following the fixed header, clause edits are packed as N consecutive 48-byte entries:

```
offset          size    field
208             2       clause_number       uint16, big-endian
210             1       edit_type           byte
211             1       reserved            byte
212             4       change_length       uint32, big-endian
216             32      change_hash         bytes32
```

Each clause edit entry: 48 bytes (40 bytes of fields + 8 bytes reserved). Total state size: `208 + clause_count * 48` bytes.

**status** values:

```
DRAFT     = 0x00  // redline is being authored (may add/remove clause edits)
PROPOSED  = 0x01  // redline sent to counterparty for review
ACCEPTED  = 0x02  // counterparty accepted all edits (terminal)
REJECTED  = 0x03  // counterparty rejected redline (terminal)
```

**edit_type** values:

```
EDIT_MODIFY   = 0x00  // clause text changed
EDIT_DELETE   = 0x01  // clause removed
EDIT_ADD      = 0x02  // new clause inserted
EDIT_COMMENT  = 0x03  // non-binding annotation
```

#### 2.2 State Machine

```
        ┌───────┐
        │ DRAFT │ ← markup() adds/removes clause edits
        └───┬───┘
            │ finalize()
            ▼
        ┌──────────┐
        │ PROPOSED │
        └────┬─────┘
      ┌──────┴──────┐
      ▼             ▼
 ┌──────────┐  ┌──────────┐
 │ ACCEPTED │  │ REJECTED │
 └──────────┘  └──────────┘
```

#### 2.3 Entrypoints

##### create_redline

```
create_redline(
    uint64  parent_offer_id,
    bytes32 counterparty_id,
    bytes32 document_hash,
    uint64  prev_redline_id,
    bytes64 metadata_uri
)
```

Initiates a new redline. Caller becomes `author_id`. Rules enforced:

1. `parent_offer_id` must reference an existing Offer covenant UTXO with `status == ACCEPTED` — redlines operate on accepted offers (the base contract).
2. `counterparty_id` must be non-zero and must not equal the caller.
3. `document_hash` must commit to the document being marked up (blake2b of the serialized base document).
4. If `prev_redline_id != 0`, that redline must exist in `ACCEPTED` state — this enables chaining (revision N builds on revision N-1).
5. On success: `status = DRAFT`, `clause_count = 0`, `created_block = current_block`.

##### markup

```
markup(
    uint64   redline_id,
    uint16   clause_number,
    byte     edit_type,
    bytes32  change_hash,
    uint32   change_length
)
```

Adds a clause-level edit to the redline. Caller must be the `author_id`. Only valid in `DRAFT` status. Rules enforced:

1. `redline_id` must exist with `status == DRAFT`.
2. Caller must match `author_id`.
3. `clause_count` must be < 255 (uint8 limit).
4. `edit_type` must be one of the defined values.
5. `change_hash` must be non-zero — blake2b hash of the changed clause text. For `EDIT_DELETE`, `change_hash` is set to a sentinel value `0x0000000000000000000000000000000000000000000000000000000000000001`. For `EDIT_COMMENT`, `change_hash` is the hash of the comment text.
6. On success, a new clause edit entry is appended at offset `208 + clause_count * 48`. `clause_count` is incremented.

##### unmark

```
unmark(
    uint64 redline_id,
    uint16 clause_number
)
```

Removes a clause-level edit from the redline. Caller must be the `author_id`. Only valid in `DRAFT` status. Rules enforced:

1. `redline_id` must exist with `status == DRAFT`.
2. Caller must match `author_id`.
3. A clause edit entry with matching `clause_number` must exist.
4. On success, the entry is removed and subsequent entries are shifted down. `clause_count` is decremented.

##### finalize

```
finalize(
    uint64 redline_id
)
```

Locks the redline and sends it to the counterparty. Caller must be the `author_id`. Only valid in `DRAFT` status. Rules enforced:

1. `redline_id` must exist with `status == DRAFT`.
2. Caller must match `author_id`.
3. `clause_count` must be > 0 — an empty redline is meaningless.
4. On success: `status = PROPOSED`.

##### accept_redline

```
accept_redline(
    uint64 redline_id
)
```

Accepts the redline. Caller must be the `counterparty_id`. Only valid in `PROPOSED` status. Rules enforced:

1. `redline_id` must exist with `status == PROPOSED`.
2. Caller must match `counterparty_id`.
3. On success: `status = ACCEPTED`, `resolved_block = current_block`.

##### reject_redline

```
reject_redline(
    uint64 redline_id
)
```

Rejects the redline. Caller must be the `counterparty_id`. Only valid in `PROPOSED` status. Rules enforced:

1. `redline_id` must exist with `status == PROPOSED`.
2. Caller must match `counterparty_id`.
3. On success: `status = REJECTED`, `resolved_block = current_block`.

#### 2.4 Descriptor

```
KCC0019RedlineDescriptor {
    prefix: bytes              // covenant script bytes before mutable state
    suffix: bytes              // covenant script bytes after mutable state
    next_redline_id: uint64    // incrementing counter
    metadata_uri: bytes64      // covenant-level metadata resource
}
```

---

### 3. ConditionalAccept

"I accept IF you also accept §4." ConditionalAccept enables package deals by cross-referencing two acceptance states from Offer covenants. Party A's acceptance of Offer X is conditional on Party B's acceptance of Offer Y. When both conditions are satisfied, the conditional acceptance resolves. If either party rejects, the conditional acceptance fails.

#### 3.1 State Layout

```
offset  size    field               encoding
0       8       cond_accept_id      uint64, big-endian
8       8       primary_offer_id    uint64, big-endian
16      8       dependent_offer_id  uint64, big-endian
24      32      party_a_id          bytes32
56      32      party_b_id          bytes32
88      1       status              byte
89      1       primary_accepted    byte
90      1       dependent_accepted  byte
91      5       reserved            bytes (zero-filled)
96      8       created_block       uint64, big-endian
104     8       resolved_block      uint64, big-endian
112     8       expires_block       uint64, big-endian
120     32      condition_hash      bytes32
152     64      metadata_uri        padded bytes64, UTF-8
```

Total: 216 bytes.

**status** values:

```
PENDING            = 0x00  // waiting for both acceptances
PRIMARY_ACCEPTED   = 0x01  // party A has accepted (waiting for party B)
DEPENDENT_ACCEPTED = 0x02  // party B has accepted (waiting for party A)
RESOLVED           = 0x03  // both have accepted (terminal, success)
REJECTED           = 0x04  // one or both rejected (terminal, failure)
EXPIRED            = 0x05  // passed expires_block without resolution (terminal)
```

**primary_accepted** / **dependent_accepted** flags:

A byte encoding the cross-reference state:

```
0x00  // not yet accepted
0x01  // accepted by the relevant party
0x02  // rejected by the relevant party
```

The `status` field is derived from these two flags:

| primary_accepted | dependent_accepted | status              |
|------------------|--------------------|-------------------- |
| 0x00             | 0x00               | PENDING             |
| 0x01             | 0x00               | PRIMARY_ACCEPTED    |
| 0x00             | 0x01               | DEPENDENT_ACCEPTED  |
| 0x01             | 0x01               | RESOLVED            |
| any 0x02         | any                | REJECTED            |

#### 3.2 State Machine

```
                    ┌─────────┐
                    │ PENDING │
                    └────┬────┘
              ┌──────────┼──────────┐
              ▼          ▼          ▼
     ┌────────────────┐ ┌────────────────┐ ┌──────────┐
     │PRIMARY_ACCEPTED│ │DEPENDENT_ACCEPT│ │ REJECTED │
     └───────┬────────┘ └───────┬────────┘ └──────────┘
             │                  │
             └────────┬─────────┘
                      ▼
               ┌──────────┐     ┌─────────┐
               │ RESOLVED │     │ EXPIRED │
               └──────────┘     └─────────┘
```

#### 3.3 Cross-Reference Mechanism

ConditionalAccept maintains a cross-reference between two Offer covenant UTXOs. Rather than duplicating offer state, it stores the `offer_id` of each and checks their on-chain status:

- `primary_offer_id` references the offer that Party A is conditionally accepting.
- `dependent_offer_id` references the offer that Party B must accept for Party A's acceptance to become effective.

The covenant does NOT verify that the referenced Offer UTXOs are in `ACCEPTED` state at creation time — that verification happens at resolution time via the `resolve` entrypoint. This allows both offers to be accepted in either order.

#### 3.4 Entrypoints

##### propose_conditional

```
propose_conditional(
    uint64  primary_offer_id,
    uint64  dependent_offer_id,
    bytes32 party_b_id,
    bytes32 condition_hash,
    uint64  expires_block,
    bytes64 metadata_uri
)
```

Creates a new conditional acceptance. Caller becomes `party_a_id`. Rules enforced:

1. `primary_offer_id` must reference an existing Offer UTXO where `counterparty_id == caller`. The caller must be the counterparty on the primary offer (i.e., they are being asked to accept it).
2. `dependent_offer_id` must reference an existing Offer UTXO where `proposer_id == party_b_id` or `counterparty_id == party_b_id`. The dependent offer must involve `party_b_id`.
3. `party_b_id` must be non-zero and must not equal the caller.
4. `condition_hash` must be non-zero — a blake2b hash describing what condition party B must meet (e.g., "accept §4 of the dependent offer").
5. `expires_block` must be > current block height.
6. On success: `status = PENDING`, `primary_accepted = 0x00`, `dependent_accepted = 0x00`, `created_block = current_block`.

##### accept_primary

```
accept_primary(
    uint64 cond_accept_id
)
```

Party A (the caller who created the conditional) confirms their acceptance of the primary offer. Only valid if the primary offer is now in `ACCEPTED` state on-chain. Rules enforced:

1. `cond_accept_id` must exist with `status == PENDING` or `status == DEPENDENT_ACCEPTED`.
2. Caller must match `party_a_id`.
3. The Offer UTXO referenced by `primary_offer_id` must exist on-chain with `status == ACCEPTED`.
4. `primary_accepted` must currently be `0x00`.
5. On success: `primary_accepted = 0x01`. If `dependent_accepted == 0x01`, `status = RESOLVED`, `resolved_block = current_block`.

##### accept_dependent

```
accept_dependent(
    uint64 cond_accept_id
)
```

Party B confirms their acceptance of the dependent offer. Rules enforced:

1. `cond_accept_id` must exist with `status == PENDING` or `status == PRIMARY_ACCEPTED`.
2. Caller must match `party_b_id`.
3. The Offer UTXO referenced by `dependent_offer_id` must exist on-chain with `status == ACCEPTED`.
4. `dependent_accepted` must currently be `0x00`.
5. On success: `dependent_accepted = 0x01`. If `primary_accepted == 0x01`, `status = RESOLVED`, `resolved_block = current_block`.

##### reject_conditional

```
reject_conditional(
    uint64 cond_accept_id
)
```

Either party may reject before resolution. Rules enforced:

1. `cond_accept_id` must exist with `status` in `{PENDING, PRIMARY_ACCEPTED, DEPENDENT_ACCEPTED}`.
2. Caller must match either `party_a_id` or `party_b_id`.
3. On success: `status = REJECTED`, `resolved_block = current_block`. The rejecting party's corresponding acceptance flag is set to `0x02`.

##### expire_conditional

```
expire_conditional(
    uint64 cond_accept_id
)
```

Marks an expired conditional acceptance. Callable by anyone. Rules enforced:

1. `cond_accept_id` must exist with `status` in `{PENDING, PRIMARY_ACCEPTED, DEPENDENT_ACCEPTED}`.
2. Current block height must be ≥ `expires_block`.
3. On success: `status = EXPIRED`, `resolved_block = current_block`.

#### 3.5 Descriptor

```
KCC0019ConditionalAcceptDescriptor {
    prefix: bytes              // covenant script bytes before mutable state
    suffix: bytes              // covenant script bytes after mutable state
    next_cond_accept_id: uint64  // incrementing counter
    metadata_uri: bytes64      // covenant-level metadata resource
}
```

---

### 4. ConsensusRecord

N parties attest that a fact is true. The record finalizes when quorum is reached. Mirrors a notarized affidavit or multi-party board resolution — each party adds their attestation; once `quorum` parties have attested, the record is finalized and the fact is considered established on-chain.

#### 4.1 State Layout

```
offset  size    field               encoding
0       8       record_id           uint64, big-endian
8       1       num_parties         uint8
9       1       quorum              uint8
10      1       attestation_count   uint8
11      1       status              byte
12      4       reserved            bytes (zero-filled)
16      8       created_block       uint64, big-endian
24      8       expires_block       uint64, big-endian
32      8       finalized_block     uint64, big-endian
40      32      fact_hash           bytes32
72      32      creator_id          bytes32
104     64      metadata_uri        padded bytes64, UTF-8
```

Total fixed header: 168 bytes.

Following the fixed header, the party list is packed as N consecutive `bytes32` entries:

```
offset          size    field
168             32      parties[0]          bytes32
168 + 32        32      parties[1]          bytes32
...
168 + (N-1)*32  32      parties[N-1]        bytes32
```

After the party list, the attestation bitmap tracks which parties have attested:

```
offset              size        field
168 + N*32          ceil(N/8)   attestations_bitmap   bytes
```

Each bit position `i` corresponds to `parties[i]`. Bit = 1 means that party has attested. Bit = 0 means not yet attested.

Total state size: `168 + N * 32 + ceil(N/8)` bytes.

**status** values:

```
OPEN       = 0x00  // accepting attestations
FINALIZED  = 0x01  // quorum reached, record is binding (terminal)
REJECTED   = 0x02  // creator rejected before quorum (terminal)
EXPIRED    = 0x03  // passed expires_block without reaching quorum (terminal)
```

#### 4.2 State Machine

```
        ┌──────┐
        │ OPEN │ ← attest() adds attestations
        └──┬───┘
    ┌──────┼──────────┐
    ▼      ▼          ▼
┌──────────┐ ┌──────────┐ ┌─────────┐
│FINALIZED │ │ REJECTED │ │ EXPIRED │
│ (quorum) │ │(pre-quor)│ │(timeout)│
└──────────┘ └──────────┘ └─────────┘
```

#### 4.3 Qubit Tracking

A quorum of `quorum` out of `num_parties` must attest. The `attestation_count` field tracks the current count. A record finalizes automatically when `attestation_count >= quorum` — no separate finalize call is required; the `attest` entrypoint transitions to `FINALIZED` inline.

#### 4.4 Entrypoints

##### create_record

```
create_record(
    bytes32[] parties,
    uint8     quorum,
    bytes32   fact_hash,
    uint64    expires_block,
    bytes64   metadata_uri
)
```

Creates a new consensus record. Caller becomes `creator_id`. Rules enforced:

1. `parties.length` must be ≥ 2 and ≤ 255 (uint8 limit).
2. `quorum` must be ≥ 2 and ≤ `parties.length`.
3. Every `parties[i]` must be non-zero and unique within the array.
4. `fact_hash` must be non-zero — blake2b hash of the attested fact.
5. `expires_block` must be > current block height.
6. The caller must appear in `parties[]` — the creator is a party to the consensus.
7. On success:
   - `record_id` set to incrementing covenant counter
   - `num_parties = parties.length`
   - `attestation_count = 1` (creator auto-attests)
   - `attestations_bitmap[creator_index] = 1`
   - `status = OPEN`
   - `created_block = current_block`

##### attest

```
attest(
    uint64 record_id
)
```

Party attests to the fact. Rules enforced:

1. `record_id` must exist with `status == OPEN`.
2. Current block height must be < `expires_block`.
3. Caller must appear in `parties[]`.
4. Caller must not have already attested (`attestations_bitmap[caller_index] == 0`).
5. On success:
   - `attestation_count` incremented
   - `attestations_bitmap[caller_index] = 1`
   - If `attestation_count >= quorum`: `status = FINALIZED`, `finalized_block = current_block`

##### reject_record

```
reject_record(
    uint64 record_id
)
```

Creator rejects the record before quorum is reached. Rules enforced:

1. `record_id` must exist with `status == OPEN`.
2. Caller must match `creator_id`.
3. `attestation_count < quorum` — cannot reject a finalized record.
4. On success: `status = REJECTED`.

##### expire_record

```
expire_record(
    uint64 record_id
)
```

Marks an expired record. Callable by anyone. Rules enforced:

1. `record_id` must exist with `status == OPEN`.
2. Current block height must be ≥ `expires_block`.
3. On success: `status = EXPIRED`.

#### 4.5 Descriptor

```
KCC0019ConsensusRecordDescriptor {
    prefix: bytes              // covenant script bytes before mutable state
    suffix: bytes              // covenant script bytes after mutable state
    next_record_id: uint64     // incrementing counter
    metadata_uri: bytes64      // covenant-level metadata resource
}
```

---

### 5. ConsensusSignal

Tracks legal states across the lifecycle of a contractual condition. Twelve entrypoints mirror litigation chronology: condition met, condition failed, deadline met, postponed, breach, remedied, waived, request agreement, attest agreement, object, withdraw, and expire. Each signal references a specific covenant and condition, creating an audit trail suitable for dispute resolution.

#### 5.1 State Layout

```
offset  size    field               encoding
0       8       signal_id           uint64, big-endian
8       32      covenant_ref        bytes32
40      8       condition_id        uint64, big-endian
48      1       signal_type         byte
49      1       status              byte
50      6       reserved            bytes (zero-filled)
56      32      signer_id           bytes32
88      32      counterparty_id     bytes32
120     8       created_block       uint64, big-endian
128     8       resolved_block      uint64, big-endian
136     8       expires_block       uint64, big-endian
144     8       deadline_block      uint64, big-endian
152     8       related_signal_id   uint64, big-endian
160     32      reason_hash         bytes32
192     64      metadata_uri        padded bytes64, UTF-8
```

Total: 256 bytes.

**signal_type** values:

```
CONDITION_MET       = 0x00  // condition has been satisfied
CONDITION_FAILED    = 0x01  // condition has definitively failed
DEADLINE_MET        = 0x02  // deadline was met (action completed on time)
DEADLINE_MISSED     = 0x03  // deadline was missed
POSTPONED           = 0x04  // deadline or condition extended
BREACH              = 0x05  // party is in breach of covenant condition
REMEDIED            = 0x06  // breach has been cured
WAIVED              = 0x07  // right under a condition has been waived
REQUEST_AGREEMENT   = 0x08  // request counterparty to agree to a state
ATTEST_AGREEMENT    = 0x09  // attest that counterparty agreed (off-chain)
OBJECT              = 0x0A  // objection to a prior signal
WITHDRAW            = 0x0B  // withdraw a prior signal
```

**status** values:

```
ACTIVE     = 0x00  // signal is in effect
SUPERSEDED = 0x01  // signal replaced by a later signal (terminal)
EXPIRED    = 0x02  // signal passed expires_block (terminal)
WITHDRAWN  = 0x03  // signal withdrawn by signer (terminal)
```

#### 5.2 State Machine

```
                    ┌────────┐
                    │ ACTIVE │
                    └───┬────┘
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
    ┌───────────┐ ┌─────────┐ ┌───────────┐
    │SUPERSEDED │ │ EXPIRED │ │ WITHDRAWN │
    │(new signal│ │(timeout)│ │(by signer)│
    │  replaces)│ └─────────┘ └───────────┘
    └───────────┘
```

A signal may be **superseded** when a new signal of a complementary type is issued for the same `(covenant_ref, condition_id)`. Supersession rules:

| Prior Signal       | Superseded By        |
|--------------------|----------------------|
| BREACH             | REMEDIED             |
| REQUEST_AGREEMENT  | ATTEST_AGREEMENT     |
| REQUEST_AGREEMENT  | OBJECT               |
| CONDITION_FAILED   | (none — terminal)    |
| BREACH             | WAIVED               |
| DEADLINE_MISSED    | POSTPONED            |

Supersession is enforced by the covenant: when a new signal is created, the covenant checks for an existing `ACTIVE` signal on the same `(covenant_ref, condition_id)` and, if the new signal's type supersedes it, transitions the prior signal to `SUPERSEDED`.

#### 5.3 Entrypoints

##### 5.3.1 signal_condition_met

```
signal_condition_met(
    bytes32 covenant_ref,
    uint64  condition_id,
    bytes32 counterparty_id,
    bytes32 reason_hash,
    uint64  expires_block,
    bytes64 metadata_uri
)
```

Asserts that a condition has been met. Rules enforced:

1. `covenant_ref` must be non-zero — references an on-chain covenant or a known contract identifier.
2. `condition_id` identifies the specific condition within the referenced covenant.
3. `reason_hash` commits to off-chain evidence that the condition is met (blake2b of supporting documents).
4. Caller becomes `signer_id`.
5. If an active `CONDITION_FAILED` signal exists for the same `(covenant_ref, condition_id)`, creation fails — a condition cannot be met after it has definitively failed.
6. On success: `signal_type = CONDITION_MET`, `status = ACTIVE`, `created_block = current_block`.
7. Any prior `CONDITION_MET` signal on the same `(covenant_ref, condition_id)` is superseded (only the latest met signal is active).

##### 5.3.2 signal_condition_failed

```
signal_condition_failed(
    bytes32 covenant_ref,
    uint64  condition_id,
    bytes32 counterparty_id,
    bytes32 reason_hash,
    uint64  expires_block,
    bytes64 metadata_uri
)
```

Asserts that a condition has definitively failed. Rules enforced:

1. Same basic validation as `signal_condition_met`.
2. `CONDITION_FAILED` is terminal — once a condition is declared failed, no `CONDITION_MET` can supersede it.
3. On success: `signal_type = CONDITION_FAILED`, `status = ACTIVE`.

##### 5.3.3 signal_deadline_met

```
signal_deadline_met(
    bytes32 covenant_ref,
    uint64  condition_id,
    bytes32 counterparty_id,
    uint64  deadline_block,
    bytes32 reason_hash,
    uint64  expires_block,
    bytes64 metadata_uri
)
```

Asserts that an action was completed before its deadline. Rules enforced:

1. `deadline_block` must be > 0 — the block by which the action was required.
2. Current block height must be ≤ `deadline_block` (the signal itself is timely).
3. `reason_hash` commits to evidence of completion.
4. On success: `signal_type = DEADLINE_MET`, `deadline_block` set to the specified deadline.

##### 5.3.4 signal_deadline_missed

```
signal_deadline_missed(
    bytes32 covenant_ref,
    uint64  condition_id,
    bytes32 counterparty_id,
    uint64  deadline_block,
    bytes32 reason_hash,
    uint64  expires_block,
    bytes64 metadata_uri
)
```

Asserts that a deadline was not met. Rules enforced:

1. Current block height must be > `deadline_block` — you cannot signal a missed deadline that has not yet passed.
2. `reason_hash` commits to evidence of non-completion.
3. On success: `signal_type = DEADLINE_MISSED`.

##### 5.3.5 signal_postponed

```
signal_postponed(
    bytes32 covenant_ref,
    uint64  condition_id,
    bytes32 counterparty_id,
    uint64  new_deadline_block,
    bytes32 reason_hash,
    uint64  expires_block,
    bytes64 metadata_uri
)
```

Extends a deadline for a condition. Rules enforced:

1. `new_deadline_block` must be > current block height.
2. If a prior `DEADLINE_MISSED` signal exists, the new_deadline_block must be > the missed deadline — you cannot retroactively fix a missed deadline.
3. On success: `signal_type = POSTPONED`, `deadline_block = new_deadline_block`. Any prior `POSTPONED` signal on the same `(covenant_ref, condition_id)` is superseded.

##### 5.3.6 signal_breach

```
signal_breach(
    bytes32 covenant_ref,
    uint64  condition_id,
    bytes32 counterparty_id,
    bytes32 reason_hash,
    uint64  expires_block,
    bytes64 metadata_uri
)
```

Asserts that a party is in breach. Rules enforced:

1. `counterparty_id` must be non-zero — the party alleged to be in breach.
2. `reason_hash` commits to evidence of breach.
3. On success: `signal_type = BREACH`, `status = ACTIVE`.
4. Any prior `BREACH` signal for the same `(covenant_ref, condition_id)` is superseded.

##### 5.3.7 signal_remedied

```
signal_remedied(
    bytes32 covenant_ref,
    uint64  condition_id,
    uint64  breach_signal_id,
    bytes32 counterparty_id,
    bytes32 reason_hash,
    uint64  expires_block,
    bytes64 metadata_uri
)
```

Asserts that a breach has been cured. Rules enforced:

1. `breach_signal_id` must reference an existing `BREACH` signal with `status == ACTIVE`.
2. `reason_hash` commits to evidence of remedy.
3. On success: `signal_type = REMEDIED`, `related_signal_id = breach_signal_id`. The referenced breach signal transitions to `SUPERSEDED`.

##### 5.3.8 signal_waived

```
signal_waived(
    bytes32 covenant_ref,
    uint64  condition_id,
    bytes32 counterparty_id,
    bytes32 reason_hash,
    uint64  expires_block,
    bytes64 metadata_uri
)
```

Waives a right under a condition. Rules enforced:

1. The caller asserts they waive a right they hold under the referenced `(covenant_ref, condition_id)`.
2. `reason_hash` commits to the scope and terms of the waiver.
3. On success: `signal_type = WAIVED`. Any active `BREACH` signal on the same `(covenant_ref, condition_id)` is superseded.

##### 5.3.9 signal_request_agreement

```
signal_request_agreement(
    bytes32 covenant_ref,
    uint64  condition_id,
    bytes32 counterparty_id,
    bytes32 reason_hash,
    uint64  expires_block,
    bytes64 metadata_uri
)
```

Requests the counterparty to agree that a state of affairs is true. Rules enforced:

1. `counterparty_id` must be non-zero — the party being asked to agree.
2. `reason_hash` commits to what is being requested (the proposed agreement text).
3. On success: `signal_type = REQUEST_AGREEMENT`, `status = ACTIVE`.

##### 5.3.10 signal_attest_agreement

```
signal_attest_agreement(
    bytes32 covenant_ref,
    uint64  condition_id,
    uint64  request_signal_id,
    bytes32 counterparty_id,
    bytes32 reason_hash,
    uint64  expires_block,
    bytes64 metadata_uri
)
```

Attests that the counterparty has agreed (typically off-chain). Rules enforced:

1. `request_signal_id` must reference an existing `REQUEST_AGREEMENT` signal with `status == ACTIVE`.
2. Caller must match the `signer_id` of the referenced request signal.
3. `reason_hash` commits to evidence of counterparty agreement (e.g., hash of signed acknowledgment).
4. On success: `signal_type = ATTEST_AGREEMENT`, `related_signal_id = request_signal_id`. The referenced request signal transitions to `SUPERSEDED`.

##### 5.3.11 signal_object

```
signal_object(
    bytes32 covenant_ref,
    uint64  condition_id,
    uint64  target_signal_id,
    bytes32 counterparty_id,
    bytes32 reason_hash,
    uint64  expires_block,
    bytes64 metadata_uri
)
```

Objects to a prior signal. Rules enforced:

1. `target_signal_id` must reference an existing signal with `status == ACTIVE`.
2. Caller must be a party to the covenant referenced by `covenant_ref` (or the counterparty of the target signal).
3. `reason_hash` commits to the basis for the objection.
4. On success: `signal_type = OBJECT`, `related_signal_id = target_signal_id`.
5. The OBJECT signal does NOT automatically supersede the target signal — both remain ACTIVE. Dispute resolution is external (arbitration, court). The object signal creates an on-chain record that a dispute exists.

##### 5.3.12 signal_withdraw

```
signal_withdraw(
    uint64 signal_id
)
```

Withdraws a prior signal. Caller must be the original `signer_id`. Rules enforced:

1. `signal_id` must exist with `status == ACTIVE`.
2. Caller must match `signer_id`.
3. `signal_type` must not be `CONDITION_FAILED` — failure declarations are non-retractable.
4. On success: the signal transitions to `WITHDRAWN`. Note: `WITHDRAWN` is a terminal status on THIS signal UTXO; the withdrawal itself creates a new implicit signal visible to indexers (tracked via the `related_signal_id` on a reversal pattern).

#### 5.4 Descriptor

```
KCC0019ConsensusSignalDescriptor {
    prefix: bytes              // covenant script bytes before mutable state
    suffix: bytes              // covenant script bytes after mutable state
    next_signal_id: uint64     // incrementing counter
    metadata_uri: bytes64      // covenant-level metadata resource
}
```

---

### 6. MultiPartyExecute

N wallets sign in sequence. All must sign within a timeout or execution fails. Mirrors multi-party contract execution: board resolutions, consortium agreements, co-signing requirements. Unlike a multisig wallet (which controls an account), MultiPartyExecute controls execution of a specific payload — it is a signaling covenant, not a custody covenant.

#### 6.1 State Layout

```
offset  size    field               encoding
0       8       execution_id        uint64, big-endian
8       1       num_signers         uint8
9       1       required_signatures uint8
10      1       signature_count     uint8
11      1       status              byte
12      4       reserved            bytes (zero-filled)
16      8       created_block       uint64, big-endian
24      8       timeout_block       uint64, big-endian
32      8       executed_block      uint64, big-endian
40      32      payload_hash        bytes32
72      32      initiator_id        bytes32
104     1       next_signer_index   uint8 (stored in first byte, remaining 31 zero)
105     23      reserved2           bytes (zero-filled)
128     64      metadata_uri        padded bytes64, UTF-8
```

Total fixed header: 192 bytes.

Following the fixed header, the signer list is packed as N consecutive `bytes32` entries:

```
offset          size    field
192             32      signers[0]          bytes32
192 + 32        32      signers[1]          bytes32
...
192 + (N-1)*32  32      signers[N-1]        bytes32
```

After the signer list, the signature bitmap tracks which signers have signed:

```
offset              size        field
192 + N*32          ceil(N/8)   signatures_bitmap   bytes
```

Each bit position `i` corresponds to `signers[i]`. Bit = 1 means that signer has signed.

Total state size: `192 + N * 32 + ceil(N/8)` bytes.

**status** values:

```
OPEN      = 0x00  // accepting signatures
EXECUTING = 0x01  // all signatures collected, awaiting execution
EXECUTED  = 0x02  // payload executed (terminal)
FAILED    = 0x03  // timeout reached without all signatures (terminal)
CANCELLED = 0x04  // cancelled by initiator before all signatures (terminal)
```

#### 6.2 State Machine

```
        ┌──────┐
        │ OPEN │ ← sign() adds signatures
        └──┬───┘
    ┌──────┼──────────┐
    ▼      ▼          ▼
┌──────────┐ ┌───────┐ ┌───────────┐
│EXECUTING │ │ FAILED│ │ CANCELLED │
│(all sigs)│ │(time.)│ │(initiator)│
└────┬─────┘ └───────┘ └───────────┘
     │
     ▼
┌──────────┐
│ EXECUTED │
└──────────┘
```

#### 6.3 Sequential Signature Collection

MultiPartyExecute requires signatures in the order defined by the `signers[]` array. The `next_signer_index` field tracks which signer is expected next:

- At creation: `next_signer_index = 0` (signers[0] must sign first)
- After signers[0] signs: `next_signer_index = 1`
- After signers[N-1] signs: `next_signer_index = N` (all signed)

The covenant enforces that only `signers[next_signer_index]` may sign at any point. This ensures the execution order matches the defined sequence — critical for legal workflows where signatories must execute in a specific order (e.g., junior officer → senior officer → CEO).

#### 6.4 Entrypoints

##### initiate_execution

```
initiate_execution(
    bytes32[] signers,
    uint8     required_signatures,
    bytes32   payload_hash,
    uint64    timeout_block,
    bytes64   metadata_uri
)
```

Creates a new multi-party execution. Caller becomes `initiator_id`. Rules enforced:

1. `signers.length` must be ≥ 2 and ≤ 255 (uint8 limit).
2. `required_signatures` must equal `signers.length` — all must sign. For partial-signature scenarios, use a governance covenant (KCC-0009).
3. Every `signers[i]` must be non-zero and unique within the array.
4. `payload_hash` must be non-zero — blake2b of the payload to be executed.
5. `timeout_block` must be > current block height.
6. The caller must appear in `signers[]` as the first signer — `signers[0] == caller`.
7. On success:
   - `execution_id` set to incrementing covenant counter
   - `num_signers = signers.length`
   - `signature_count = 1` (initiator auto-signs as first signer)
   - `signatures_bitmap[0] = 1`
   - `next_signer_index = 1`
   - `status = OPEN`
   - `created_block = current_block`

##### sign

```
sign(
    uint64 execution_id
)
```

Records a signature from the next expected signer. Rules enforced:

1. `execution_id` must exist with `status == OPEN`.
2. Current block height must be < `timeout_block`.
3. Caller must match `signers[next_signer_index]`.
4. Caller must not have already signed (`signatures_bitmap[caller_index] == 0`).
5. On success:
   - `signature_count` incremented
   - `signatures_bitmap[next_signer_index] = 1`
   - `next_signer_index` incremented
   - If `signature_count == num_signers`: `status = EXECUTING`. The execution payload is now authorized.

##### execute

```
execute(
    uint64 execution_id
)
```

Triggers execution after all signatures are collected. Callable by anyone. Rules enforced:

1. `execution_id` must exist with `status == EXECUTING`.
2. `signature_count == num_signers`.
3. Current block height must be < `timeout_block`.
4. On success: `status = EXECUTED`, `executed_block = current_block`.
5. The covenant emits an execution event with `payload_hash`. The actual payload execution (e.g., deploying a contract, initiating a transfer) is handled by a composable covenant that consumes the MultiPartyExecute UTXO as authorization — MultiPartyExecute itself is a signaling covenant and does not perform the payload action.

##### cancel_execution

```
cancel_execution(
    uint64 execution_id
)
```

Cancels an execution before all signatures are collected. Caller must be the `initiator_id`. Rules enforced:

1. `execution_id` must exist with `status == OPEN`.
2. Caller must match `initiator_id`.
3. On success: `status = CANCELLED`.

##### expire_execution

```
expire_execution(
    uint64 execution_id
)
```

Marks an execution as failed due to timeout. Callable by anyone. Rules enforced:

1. `execution_id` must exist with `status == OPEN`.
2. Current block height must be ≥ `timeout_block`.
3. On success: `status = FAILED`.

#### 6.5 Descriptor

```
KCC0019MultiPartyExecuteDescriptor {
    prefix: bytes              // covenant script bytes before mutable state
    suffix: bytes              // covenant script bytes after mutable state
    next_execution_id: uint64  // incrementing counter
    metadata_uri: bytes64      // covenant-level metadata resource
}
```

---

## Encoding

### Relationship to Token Standards

The six sub-conventions in KCC-0019 are **signaling conventions**, not token standards. They do not define fungible or non-fungible tokens, do not use `token_id`, `token_kind`, or `amount` fields, and do not implement `transfer`, `mint`, or `burn`. They exist alongside token standards and compose with them.

Key distinctions from token standards (KCC-0008, KCC-0009, KCC-0020):

| Property | Token Standards | Signaling Conventions |
|----------|----------------|----------------------|
| Value transfer | Yes (amount field) | No — records intent only |
| State mutability | Amount changes across transfers | Status field transitions across lifecycle |
| Token ID | Required (`token_id`, `token_kind`) | Not used — no token semantics |
| Signature model | Holder-signed per transfer | Role-based (proposer, counterparty, party, signer) |
| Extended digest | `blake2b(extended_state)` | Not used — state is self-contained |
| Descriptor | KCC-0020 prefix/suffix pattern | Adopts prefix/suffix pattern for tooling compatibility |

### Encoding for Tooling

Each sub-convention follows the KCC-0016 ABI pattern: entrypoints declare parameter types, state fields are ordered and typed, and descriptors enable auto-discovery. The byte-level state layouts in this document are the authoritative encoding — implementers read fields at the documented offsets with the documented sizes and endianness.

For **witness semantics**, signaling conventions use standard KCC-0001 authorization:

- The covenant verifies that `signatures[0]` (for single-party entrypoints) or `sigs[i]` (for multi-party) is a valid signature over the transaction sighash by the party identified by the relevant pubkey hash field (`proposer_id`, `author_id`, `party_a_id`, `creator_id`, `signer_id`, `initiator_id`).
- Entrypoints callable by anyone (`expire`, `expire_conditional`, `expire_record`, `expire_execution`) do not require authorization — any party may submit the expiry transaction.

### Cross-Covenant References

Several sub-conventions store references to other covenant UTXOs:

- **Redline** → Offer: `parent_offer_id` references an Offer UTXO. `prev_redline_id` references another Redline UTXO.
- **ConditionalAccept** → Offer: `primary_offer_id` and `dependent_offer_id` reference Offer UTXOs.
- **ConsensusSignal** → Covenant: `covenant_ref` references any on-chain covenant. `related_signal_id` references another ConsensusSignal UTXO.
- **MultiPartyExecute** → None (self-contained execution).

These references are **informational** — the referencing covenant does not enforce the existence or state of the referenced UTXO at creation time. Verification happens at the entrypoint that depends on the reference (e.g., `accept_primary` checks that the Offer UTXO is `ACCEPTED`; `signal_remedied` checks that the breach signal is `ACTIVE`). This design allows offers and signals to be created in any order, with cross-reference validation deferred until the point of resolution.

---

## KCC-0020 Alignment

### What KCC-0019 Adopts from KCC-0020

These signaling conventions adopt the following from KCC-0020:

- **Descriptor pattern**: `prefix/suffix` covenant script bytes for template identification, enabling wallets and indexers to recognize the covenant. Each sub-convention publishes its own descriptor.
- **Metadata URI**: `metadata_uri` field (bytes64, UTF-8 padded) for off-chain metadata — covenant-level identity documents, terms templates, or governance charters.
- **Entrypoint dispatch**: standard KCC-0001 entrypoint dispatch tags for each sub-convention's entrypoints, enabling tooling auto-discovery via KCC-0016 ABI.

### What KCC-0019 Does NOT Use from KCC-0020

These signaling conventions deliberately diverge from KCC-0020:

- **No transfer leader/delegator pattern**: None of the six sub-conventions use `transfer(State[], sig[], byte[])` / `transfer_delegator()`. They are signaling covenants, not transfer covenants. There is no value movement, no amount conservation, no positional input/output pairing.
- **No Borrowed Receive**: The `witness == 0xFF` Borrowed Receive extension is not applicable. There are no deposits into signaling covenants — state is created via explicit creation entrypoints (`propose`, `create_redline`, `propose_conditional`, `create_record`, `signal_*`, `initiate_execution`).
- **No allowance system**: approve/transfer_from from KCC-0008 are not relevant. Signaling conventions do not delegate spending authority.
- **No token_id / token_kind / amount**: These fields do not exist in any KCC-0019 state layout. Signaling covenants track legal states, not token balances.

### Why the Divergence

KCC-0020 defines how value moves. KCC-0019 defines how legal intent is recorded. These are complementary but orthogonal concerns. A contract may use KCC-0008 tokens to represent assets, KCC-0020 transfers to move them, AND KCC-0019 signals to track the legal state of the agreement. The signaling conventions are designed to compose with token conventions, not replace or extend them.

---

## Composability

### How Each Sub-Convention Composes

#### Offer

- **With KCC-0008 (Multi-Token)**: An accepted Offer can reference a set of token_ids as the subject of the agreement. The `terms_hash` commits to the token allocation.
- **With KCC-0009 (Governed Token)**: An accepted Offer can trigger a governance proposal (propose → second → execute) to deploy assets per the agreed terms.
- **With Redline**: Redlines reference `parent_offer_id` — negotiation happens on top of an accepted base offer.

#### Redline

- **With Offer**: `parent_offer_id` links to the accepted offer being negotiated. Chained redlines (`prev_redline_id`) create a revision history.
- **With KCC-0008**: When redlines modify token allocation terms, the final accepted redline's `document_hash` can be referenced by the token deployment transaction.
- **With MultiPartyExecute**: The final accepted redline can trigger a MultiPartyExecute for multi-signer deployment.

#### ConditionalAccept

- **With Offer**: Cross-references two Offer UTXOs. When resolved, both offers are accepted — enabling package deals.
- **With ConsensusRecord**: Parties can use a ConsensusRecord to attest that the condition (e.g., "Party B accepts §4") has been satisfied, providing an on-chain fact for the `accept_dependent` entrypoint.
- **With KCC-0009**: A resolved ConditionalAccept can trigger a governance proposal that executes a multi-party token allocation.

#### ConsensusRecord

- **With OracleRegistry (KCC-0018)**: Oracle operators use ConsensusRecord to attest to price feeds, diversity checks, and operational facts. The ConsensusRecord provides the multi-party attestation that complements the OracleRegistry's operator lifecycle.
- **With ConsensusSignal**: A finalized ConsensusRecord can serve as evidence for a `CONDITION_MET` or `ATTEST_AGREEMENT` signal.
- **With KCC-0008**: A ConsensusRecord can attest to a token's total supply, metadata, or compliance status.

#### ConsensusSignal

- **With any covenant**: `covenant_ref` references any on-chain covenant. Common compositions:
  - **With KCC-0009 (Governed Token)**: Signal breach when a proposal fails to execute, or condition_met when quorum is reached.
  - **With KCC-0018 (OracleRegistry)**: Signal condition_met when an oracle operator meets diversity requirements.
  - **With KCC-0022 (ISDA Derivatives)**: Signal condition_met/condition_failed for rate fixings, payment calculations, and close-out events.
  - **With KCC-0023 (Lending)**: Signal breach when collateral ratio falls below threshold.
  - **With KCC-0024 (Trade Finance)**: Signal deadline_met/deadline_missed for shipment, inspection, and payment milestones.
- **Self-composition**: Signals compose with other signals — REMEDIED references BREACH, ATTEST_AGREEMENT references REQUEST_AGREEMENT, OBJECT references any signal. This creates a complete audit trail for dispute resolution.

#### MultiPartyExecute

- **With any covenant that requires multi-signer authorization**: The MultiPartyExecute UTXO serves as authorization proof for a subsequent transaction. The consuming covenant checks:
  1. The MultiPartyExecute UTXO is in `EXECUTED` status.
  2. The `signature_count == num_signers`.
  3. The `payload_hash` matches the expected payload.
- **With KCC-0009 (Governed Token)**: A MultiPartyExecute can replace the propose/second/execute lifecycle for one-off multi-signer actions, with the executed payload triggering a token transfer.
- **With KCC-0008**: Multi-party minting or burning of tokens.
- **With Redline**: Execute the final accepted redline as a multi-signer deployment.

---

## Rules

### General

1. All KCC-0019 sub-conventions are **signaling covenants** — they record legal intent, not value transfer. No `amount`, `token_id`, or `token_kind` fields exist.
2. Each sub-convention uses a unique incrementing counter for its primary identifier (`offer_id`, `redline_id`, `cond_accept_id`, `record_id`, `signal_id`, `execution_id`). Counters are per-covenant-deployment, not global.
3. Terminal states (`ACCEPTED`, `REJECTED`, `EXPIRED`, `CANCELLED`, `FINALIZED`, `EXECUTED`, `FAILED`, `RESOLVED`, `WITHDRAWN`, `SUPERSEDED`) are irreversible — no further state transitions are permitted on a terminal UTXO.
4. `metadata_uri` must be present in every state layout and may be zero-padded if unused. It provides off-chain context for indexers and wallets.

### Offer

5. An Offer must be accepted by the exact `counterparty_id` specified at creation. No third-party acceptance.
6. The `terms_hash` in `accept` must exactly match the offer's `terms_hash` — mirror-image rule. Any deviation is a counter-offer (requires a new Offer).
7. `expires_block` is immutable after creation. An offer cannot be extended — a new offer must be created.
8. Only the proposer may cancel; only the counterparty may accept or reject.

### Redline

9. `clause_count` must be ≤ 255. Each clause edit is 48 bytes.
10. `edit_type` must be a valid value (`EDIT_MODIFY`, `EDIT_DELETE`, `EDIT_ADD`, `EDIT_COMMENT`).
11. `parent_offer_id` must reference an Offer in `ACCEPTED` state at creation time.
12. A redline must have `clause_count > 0` before it can be finalized.
13. After finalization (`PROPOSED`), no further `markup` or `unmark` operations are permitted.

### ConditionalAccept

14. `primary_offer_id` and `dependent_offer_id` must reference distinct Offer UTXOs.
15. `party_a_id` and `party_b_id` must be distinct.
16. The caller of `accept_primary` (Party A) must be the counterparty on the primary offer. The caller of `accept_dependent` (Party B) must be the counterparty or proposer on the dependent offer.
17. Either party may reject at any time before resolution. Rejection by either party is terminal.

### ConsensusRecord

18. `num_parties` must be ≥ 2 and ≤ 255.
19. `quorum` must be ≥ 2 and ≤ `num_parties`.
20. Every `parties[i]` must be unique. No duplicate signers.
21. The creator is always `parties[0]` or the matching index — the creator auto-attests at creation.
22. Once `attestation_count >= quorum`, the record auto-finalizes within the `attest` transaction.
23. A finalized record cannot be rejected.

### ConsensusSignal

24. Each signal is scoped to a `(covenant_ref, condition_id)` pair. Multiple active signals may coexist for the same pair if they are of different, non-conflicting types.
25. `CONDITION_FAILED` is terminal — no `CONDITION_MET` can supersede it.
26. `OBJECT` does not supersede its target signal — both remain ACTIVE. Dispute resolution is off-chain.
27. A signal may only be withdrawn by its original `signer_id`.
28. Supersession rules are enforced by the covenant at creation time — the covenant checks for existing ACTIVE signals on the same `(covenant_ref, condition_id)` and transitions them to `SUPERSEDED` if the new signal type supersedes the existing type.

### MultiPartyExecute

29. `num_signers` must be ≥ 2 and ≤ 255.
30. `required_signatures` must equal `num_signers` — all signers must sign. No partial execution.
31. Signatures must be collected in sequential order (`signers[0]`, then `signers[1]`, ...). A signer may only sign when `next_signer_index` points to their position.
32. Execution is not automatic — the `execute` entrypoint must be called after all signatures are collected, and before `timeout_block`.
33. MultiPartyExecute is a signaling covenant — it does not perform the payload action. It authorizes execution; a consuming covenant performs the action.

---

## Reference

The author maintains conforming implementations for each sub-convention. This document defines the conventions; implementations demonstrate conformance.

Companion standards:

- **KCC-0001** (IzioDev): Covenant ownership, authorization model, and entrypoint dispatch tags.
- **KCC-0008**: Multi-Token Standard — the asset layer that signaling conventions compose with.
- **KCC-0009**: Governed Token Standard — governance-gated transfers that composable with signaling.
- **KCC-0016**: Covenant ABI — interface discovery format adopted by all KCC-0019 sub-conventions.
- **KCC-0018**: Oracle Registry — operator lifecycle; ConsensusRecord composes with it for multi-party attestation.
- **KCC-0020**: Fungible Token Covenant — the transfer pattern that signaling conventions deliberately diverge from, while adopting its descriptor pattern.
- **KCC-0022**: ISDA Derivatives — uses ConsensusSignal for rate fixings and close-out events.
- **KCC-0023**: Lending — uses ConsensusSignal for collateral breach tracking.
- **KCC-0024**: Trade Finance — uses ConsensusSignal for milestone condition tracking.