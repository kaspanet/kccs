# KCC-0014: Soulbound Token Standard

| Field | Value |
|-------|-------|
| **KCC** | 0014 |
| **Category** | Asset Standard |
| **Title** | Soulbound Token — Non-Transferable Identity and Credentials |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |
| **Depends on** | KCC-0008 (PR #10, draft), KCC-0020 (PR #2, draft) |
| **Updated** | 2026-07-25 |

## Abstract

A token that cannot be transferred. Once issued, it is permanently bound to its holder. It represents identity assertions, credentials, memberships, and attestations — facts about a participant, not value to be moved. The standard defines a byte-level state layout, five entrypoints (issue, revoke, burn, update, verify), and a descriptor format. The `verify` entrypoint returns standardized byte-level output so other covenants can programmatically check KYC status, credentials, or licenses without transfer machinery.

## Motivation

KCC-0008 and KCC-0020 are built around transferability — value moves between holders. Their entrypoints, witness semantics, and state transitions exist to enable and constrain transfers. But many on-chain assertions are non-transferable by nature: a KYC verification, a professional license, a DAO membership, or an accredited-investor attestation. Representing these as transferable tokens introduces security risks (credential theft, impersonation) and conceptual mismatch.

A dedicated soulbound standard allows issuers to bind assertions to holders immutably, lets holders voluntarily relinquish them, and lets any covenant call `verify` to gate access — all without the complexity or risk of a transfer code path.

## Specification

### State Layout

Every KCC-0014 covenant state begins with the following fields, in this order and encoding:

```
offset  size    field           encoding
0       1       token_type      uint8, enum (see below)
1       1       status          uint8, enum (see below)
2       32      issuer          bytes32 (public key hash)
34      32      holder          bytes32 (public key hash)
66      8       issued_at       uint64, big-endian (Unix timestamp)
74      8       expires_at      uint64, big-endian (0 = permanent)
82      2       metadata_len    uint16, big-endian
84      var     metadata        bytes, variable-length (0–65535 bytes)
```

Total fixed overhead: 84 bytes plus `metadata_len` bytes.

**token_type** values:

```
KYC           = 0x00  // identity verification (AML, KYC, sanctions check)
CREDENTIAL    = 0x01  // professional qualification or certification
MEMBERSHIP    = 0x02  // DAO, organization, or community membership
LICENSE       = 0x03  // time-bound operating license or permit
// 0x04–0xFF reserved for future types
```

**status** values:

```
ACTIVE   = 0x00  // token is valid, verify() returns valid=true
REVOKED  = 0x01  // issuer has revoked; terminal state
EXPIRED  = 0x02  // expires_at has passed; update() may renew
BURNED   = 0x03  // holder has voluntarily burned; terminal state
```

**issuer** identifies the authority that created the token. Signature from this key is required for `issue`, `revoke`, and `update`.

**holder** identifies the token's bound participant. Immutable after `issue`. No entrypoint changes this field.

**issued_at** records the Unix timestamp when the token was created.

**expires_at** records when the token ceases to be valid. A value of `0` means the token never expires. A non-zero value that is less than or equal to the current block timestamp means the token is expired. An expired token fails `verify` but may be renewed by `update`.

**metadata_len** is the number of bytes in the `metadata` field. Zero is valid — a token may carry no metadata.

**metadata** contains credential-specific data. Format is undefined at this layer; conventions may specify structured payloads (e.g., JSON, CBOR) for particular token types. Indexers and wallets treat it as opaque bytes.

### Core Entrypoints

#### issue

```
issue(
    bytes32 recipient,       // holder public key hash
    uint8   token_type,      // one of the defined token_type values
    uint64  expires_at,      // 0 = permanent
    uint16  metadata_len,
    byte[]  metadata         // metadata_len bytes
)
```

Creates a new soulbound token. Caller must produce a signature matching `issuer`. Rules:

1. `token_type` must be a recognized value (0x00–0x03).
2. No token may already exist for `(recipient, token_type)` with status ACTIVE or EXPIRED. Tokens with status REVOKED or BURNED do not block re-issuance — the prior record is terminal and the new issue creates a fresh state.
3. On success, a new UTXO is produced with `status = ACTIVE`, `issuer` set to the caller, `holder = recipient`, `issued_at` set to the current block timestamp, and the provided `expires_at` and `metadata`.

#### revoke

```
revoke(
    bytes32 holder,
    uint8   token_type
)
```

Revokes a soulbound token. Caller must produce a signature matching the `issuer` of the target token. Rules:

1. A token for `(holder, token_type)` must exist with status ACTIVE or EXPIRED.
2. On success, the consumed UTXO's state is transitioned: `status` set to REVOKED. All other fields are preserved.
3. REVOKED is a terminal state — no further transitions are permitted on this UTXO. The token can never become ACTIVE again.

#### burn

```
burn(
    uint8 token_type
)
```

Holder voluntarily relinquishes their own soulbound token. Caller must produce a signature matching the `holder` field of the target token. Rules:

1. A token for `(caller, token_type)` must exist with status ACTIVE or EXPIRED.
2. On success, `status` is set to BURNED. All other fields are preserved.
3. BURNED is a terminal state — no further transitions are permitted. The token can never become ACTIVE again.

#### update

```
update(
    bytes32 holder,
    uint8   token_type,
    uint64  new_expires_at,     // 0 = permanent, or any future timestamp
    uint16  new_metadata_len,
    byte[]  new_metadata        // new_metadata_len bytes
)
```

Updates the metadata and/or expiry of a soulbound token. Caller must produce a signature matching the `issuer` of the target token. Rules:

1. A token for `(holder, token_type)` must exist with status ACTIVE or EXPIRED.
2. If status is EXPIRED, `update` resets it to ACTIVE — this is the renewal mechanism. `issued_at` is preserved (it records the original issue, not the renewal).
3. If status is REVOKED or BURNED, `update` fails.
4. On success, `expires_at` and `metadata` (including `metadata_len`) are replaced with the provided values. All other fields are preserved.

#### verify

```
verify(
    bytes32 holder,
    uint8   token_type
) -> byte[42]
```

Read-only entrypoint. Examines the token state for `(holder, token_type)` and returns a fixed-size byte sequence. No signatures required — any covenant or wallet may call this. Rules:

1. If no token exists for `(holder, token_type)`, or if the token's status is not ACTIVE, returns `valid = false` with zeroed remaining fields.
2. If status is ACTIVE but `expires_at != 0` and `expires_at <= current_block_timestamp`, the token is expired. Returns `valid = false` with zeroed remaining fields and the caller should interpret this as "token exists but is expired."
3. If status is ACTIVE and not expired, returns `valid = true` with the token's `token_type`, `issuer`, and `expires_at`.

Return format, byte-level:

```
offset  size    field           encoding
0       1       valid           uint8 (0x00 = false, 0x01 = true)
1       1       token_type      uint8
2       32      issuer          bytes32
34      8       expires_at      uint64, big-endian
```

Total: 42 bytes.

When `valid == 0x00`, callers MUST treat `token_type`, `issuer`, and `expires_at` as undefined — they contain zeroed or stale data and carry no meaning.

### Descriptor

Each KCC-0014 covenant must publish a descriptor:

```
KCC0014Descriptor {
    prefix: bytes              // covenant script bytes before mutable state
    suffix: bytes              // covenant script bytes after mutable state
    issuer: bytes32            // public key hash of the issuing authority
    supported_types: uint8[]   // token_type values this deployment issues
}
```

The descriptor allows wallets, indexers, and verifier covenants to discover the covenant, decode its state, and determine which token types it supports.

### KCC-0020 Alignment

This standard does **not** adopt KCC-0020's transfer pattern. There is no `transfer` entrypoint, no leader/delegator protocol, no Borrowed Receive extension, and no positional witness semantics for value movement. The `holder` field is immutable after `issue` by design.

Where this standard aligns with KCC-0020 conventions:

| Feature | KCC-0020 | KCC-0014 |
|---------|:---:|:---:|
| Transfer leader/delegator | ✓ | ✗ |
| Standard transfer | ✓ | ✗ |
| Borrowed Receive | ✓ | ✗ |
| Positional I/O pairing | ✓ | ✗ |
| Descriptor prefix/suffix | ✓ | ✓ |
| Offset-based state layout | ✓ | ✓ |
| Big-endian encoding | ✓ | ✓ |
| Immutable holder binding | ✗ | ✓ |
| Read-only verify with fixed output | ✗ | ✓ |
| Issuer-controlled lifecycle | ✗ | ✓ |

Where this standard aligns with KCC-0020 conventions:

- **Big-endian encoding**: numeric fields (`uint64`, `uint16`) use network byte order.
- **Offset-based state layout**: fields are accessed by fixed byte offsets, not by name-based deserialization.
- **Descriptor prefix/suffix pattern**: covenant script bytes are split around mutable state for template identification.

These are encoding conventions, not semantic alignment. A KCC-0014 covenant is not a KCC-0020 token and should not be treated as one by wallets or DEXes.

## Encoding

This standard defines the complete byte-level layout and entrypoint semantics for soulbound tokens. Unlike transferable token standards, there is no transfer leader/delegator pattern and no positional witness scheme for value movement.

### Issue: creating the initial UTXO

The `issue` entrypoint produces exactly one covenant output UTXO. The state bytes are written in the layout specified in [State Layout](#state-layout):

```
[token_type:1][status:1=0x00][issuer:32][holder:32][issued_at:8][expires_at:8][metadata_len:2][metadata:var]
```

The issuing covenant verifies the caller's signature against `issuer`, checks that no active token exists for `(recipient, token_type)`, and populates all fields. The new UTXO is immediately verifiable by any caller of `verify`.

### Revoke and burn: terminal state transitions

Both `revoke` and `burn` consume the existing token UTXO and produce an output UTXO with identical fields except `status`. These are state mutations, not value transfers — `holder` never changes.

```
Revoke:  status  ACTIVE/EXPIRED → REVOKED (terminal)
Burn:    status  ACTIVE/EXPIRED → BURNED   (terminal)
```

A terminal UTXO (REVOKED or BURNED) remains on-chain as an immutable record. It cannot be modified, transferred, or renewed. Wallets and indexers should surface terminal records as historical artifacts.

### Update: metadata and expiry modification

The `update` entrypoint consumes the existing token UTXO and produces an output UTXO with modified `expires_at`, `metadata_len`, and `metadata`. `holder`, `issuer`, `issued_at`, and `token_type` are preserved. If the consumed status was EXPIRED, it resets to ACTIVE — this is the renewal path.

```
Update (ACTIVE):  status ACTIVE → ACTIVE,  new expires_at + metadata
Update (EXPIRED): status EXPIRED → ACTIVE, new expires_at + metadata (renewal)
```

### Verify: cross-covenant read path

The `verify` entrypoint produces no new UTXO — it is a state read, not a cross-covenant call. To use `verify`, a consuming covenant reads the KCC-0014 token's UTXO state bytes directly (no cross-call needed — just parse the known state layout). If the KCC-0014 UTXO is consumed in the same transaction, the covenant reads the consumed state. If only read access is needed, the UTXO is referenced by outpoint and its state bytes are read without consumption. The return format is the fixed 42-byte sequence defined above.

## Rules

1. `holder` is immutable after `issue`. No entrypoint changes it. No transfer entrypoint exists.
2. Only the `issuer` may call `issue`, `revoke`, or `update`. Signatures are validated against the `issuer` field of the target token.
3. Only the `holder` may call `burn`. Signature is validated against the `holder` field.
4. `(holder, token_type)` uniquely identifies a soulbound token within a deployment. At most one token with status ACTIVE or EXPIRED may exist for a given pair.
5. REVOKED and BURNED are terminal states. No entrypoint accepts them as input for modification. A terminal record does not block re-issuance — a new `issue` for the same `(holder, token_type)` creates a fresh ACTIVE token.
6. EXPIRED tokens fail `verify` but remain renewable via `update`. The issuer may reset the status to ACTIVE with a new `expires_at`.
7. `verify` returns a fixed 42-byte sequence. When `valid == 0x00`, all other return fields are undefined and must not be interpreted.
8. `verify` is read-only — it produces no covenant outputs and requires no signatures.
9. `metadata` is opaque bytes at this layer. Interpreters (wallets, indexers, verifier covenants) may parse it according to conventions for the `token_type`. A `metadata_len` of 0 is valid.
10. The descriptor must be published before any wallet, indexer, or verifier covenant can interact with the deployment.

## Reference

The author maintains a conforming implementation. This document defines the convention; an implementation demonstrates conformance.

Related standards:

- **KCC-0001** (Covenant Owner Identification): defines `issuer` and `holder` signature validation.
- **KCC-0008** (Multi-Token Standard): defines the transferable token model that soulbound tokens complement. A verifier covenant using KCC-0008 tokens may call KCC-0014 `verify` to gate minting or transfer on credential status.
- **KCC-0020** (Fungible Token Covenant): defines transfer encoding conventions; this standard shares only its big-endian offset-based state layout convention, not its transfer semantics.