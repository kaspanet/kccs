# KCC-0017: Oracle Attestation Format

| Field | Value |
|-------|-------|
| **KCC** | 0017 |
| **Category** | Interoperability |
| **Title** | Oracle Attestation Format — Signed Price Data Standard |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |
| **Updated** | 2026-07-25 |

## Abstract

A standard binary format for oracle-signed attestations on Kaspa. Every oracle operator signs attestations in this format; every covenant verifies attestations against this format. This convention defines the byte-level attestation structure, price encoding, signature scheme, bundle format, verification flow, and integration with the Oracle Registry (KCC-0018). A covenant written against this format can consume attestations from any compliant oracle operator.

## Motivation

Conditional tokens (KCC-0011), RWA tokens (KCC-0013), ISDA derivatives (KCC-0022), lending contracts (KCC-0023), and trade finance instruments (KCC-0024) all depend on oracle attestations. Without a standard attestation format, every oracle network produces data in its own format and every covenant must be hard-coded to a specific oracle. This convention makes attestations interchangeable — a covenant written against KCC-0017 can consume attestations from any KCC-0018-registered operator.

## Specification

### Attestation Structure

An attestation is a 169-byte binary blob signed by the oracle operator's SECP256k1 key. The signed payload (bytes 0–104) is hashed and signed; the signature occupies bytes 105–168.

```
offset  size    field               encoding
0       1       version             byte (0x01)
1       32      pair                bytes32 (ASCII, null-padded)
33      8       price_numerator     uint64, big-endian
41      8       price_denominator   uint64, big-endian
49      8       timestamp           uint64, big-endian (Unix milliseconds)
57      8       block_height        uint64, big-endian
65      8       nonce               uint64, big-endian (monotonic, per-operator)
73      32      operator_id         bytes32 (SECP256k1 compressed pubkey, 33 bytes → truncated)
105     64      signature           bytes64 (SECP256k1 signature over bytes 0–104)
```

Total: **169 bytes.** Signature covers bytes 0–104 (105 bytes). The signing hash is `blake2b(bytes[0:105], digest_size=32, key="OracleAttestationHash")`. The 32-byte key provides domain separation from transaction signing and personal message signing.

**Note on operator_id**: SECP256k1 compressed public keys are 33 bytes (0x02 or 0x03 prefix + 32 bytes of x-coordinate). For the attestation format, the prefix byte is dropped and only the 32-byte x-coordinate is stored. Verification recovers the full public key from the signature and checks that the x-coordinate matches.

### Field Descriptions

| Field | Bytes | Description |
|-------|:-----:|-------------|
| version | 1 | Format version. 0x01 = current. |
| pair | 32 | Trading pair identifier (e.g., `"KAS/USD"`). ASCII, null-padded. |
| price_numerator | 8 | Numerator of the rational price. |
| price_denominator | 8 | Denominator. 1 = direct price; 100000 = price in micro-units. Must never be zero. |
| timestamp | 8 | Observation time in Unix milliseconds. Monotonic per operator. |
| block_height | 8 | Kaspa block height at time of observation. |
| nonce | 8 | Monotonically increasing counter per operator. Prevents replay. |
| operator_id | 32 | x-coordinate of the operator's SECP256k1 compressed public key. Matches `operator_id` in the KCC-0018 registry. |
| signature | 64 | SECP256k1 signature (r || s, each 32 bytes big-endian) over blake2b(bytes[0:105]). |

### Price Encoding

Prices are encoded as a rational number: `price = numerator / denominator`. This avoids floating-point errors inherent in IEEE 754.

Examples:

| Pair | Price | numerator | denominator |
|------|-------|-----------|-------------|
| KAS/USD | $0.02731 | 2731 | 100000 |
| BTC/USD | $85,432.50 | 8543250 | 100 |
| KAS/BTC | 0.00000032 | 32 | 100000000 |

For direct integer prices, denominator = 1. For all prices, denominator must be > 0.

### Nonce and Replay Protection

The `nonce` field is a monotonically increasing counter per operator. A verifying covenant may track the last observed nonce per `operator_id` and reject attestations where `nonce ≤ last_nonce`. This prevents an attacker from replaying a stale attestation.

Nonce tracking is contract-local — each verifying contract maintains its own `last_nonce` per operator. The registry does not enforce nonce ordering globally. This avoids a central nonce bottleneck while still providing per-contract replay protection.

### Verification Flow

A covenant verifies an attestation in five steps:

1. **Format check**: `version == 0x01` and blob length == 169 bytes.
2. **Pair match**: bytes `[1:33]` must match the expected trading pair string (null-padded).
3. **Freshness check**: `current_block - block_height ≤ max_attestation_age` (the verifying contract's configured maximum, typically 10 blocks).
4. **Signature verification**: recover the SECP256k1 public key from `signature` (bytes 105–168) over `blake2b(bytes[0:105], digest_size=32, key="OracleAttestationHash")`. Verify that the recovered key's x-coordinate (bytes 1–32 of the 33-byte compressed key) matches `operator_id`.
5. **Registry check**: verify that `operator_id` is a registered operator in the KCC-0018 Oracle Registry with `status == ACTIVE` and `current_block - last_heartbeat ≤ heartbeat_timeout`.

If all five checks pass, the attestation is valid and the price value `(price_numerator, price_denominator)` may be used.

### Attestation Bundles

Multiple attestations may be packed into a single transaction input. The bundle format is:

```
offset  size    field
0       2       count               uint16, big-endian (number of attestations)
2       2       attestation_size    uint16, big-endian (= 169)
4       169*N   attestations        169-byte attestation blobs, concatenated
```

Total bundle size: `4 + 169 * count` bytes.

A verifying covenant reads `count` and `attestation_size`, then iterates over `count` attestations. It selects the attestation whose `pair` field matches its expected pair. If multiple attestations match, it uses the one with the highest `nonce`.

### Integration with KCC-0011 (Conditional Token)

When a KCC-0011 conditional token calls `resolve()`, the caller provides a KCC-0017 attestation blob as input data. The `resolve` entrypoint:

1. Parses the attestation per the structure above.
2. Verifies the attestation per the Verification Flow (5 steps).
3. Extracts `price_numerator` and `price_denominator`.
4. Evaluates the condition (e.g., for PRICE_ABOVE: computes `price_numerator / price_denominator` using integer arithmetic and compares against the threshold in `condition_params`).
5. Sets `status = MET` or `status = FAILED` accordingly.

### Integration with KCC-0013 (RWA Token)

When a KCC-0013 RWA token calls `verify_asset()`, the oracle provides a KCC-0017 attestation attesting to the net asset value. The verifying contract:

1. Uses `pair` field to carry the asset identifier (e.g., `"NAV/REAL_ESTATE_001"`).
2. Uses `price_numerator` to carry `nav_per_token` (in cents).
3. Uses `price_denominator = 1`.
4. Verifies per the standard Verification Flow.

### Descriptor

Each oracle operator's attestation endpoint should publish a descriptor:

```
KCC0017AttestationDescriptor {
    version: uint8              // 0x01
    operator_id: bytes32        // matches operator_id in KCC-0018 registry
    supported_pairs: bytes32[]  // trading pairs this operator attests
    min_interval: uint64        // minimum milliseconds between attestations
    endpoint: bytes64           // operator's attestation endpoint URI
}
```

The descriptor allows wallets and contracts to discover which pairs an operator supports and how frequently attestations are produced.

### KCC-0020 Alignment

This standard does **not** implement the KCC-0020 transfer interface. It defines a binary data format, not a token.

| Feature | KCC-0020 | KCC-0017 |
|---------|:---:|:---:|
| Transfer leader/delegator | ✓ | ✗ |
| Standard transfer | ✓ | ✗ |
| Borrowed Receive | ✓ | ✗ |
| Big-endian encoding | ✓ | ✓ |
| SECP256k1 signatures | ✓ | ✓ |
| Blake2b hashing | ✓ | ✓ |
| Descriptor prefix/suffix | ✓ | ✓ |
| Binary attestation format | ✗ | ✓ |
| Rational price encoding | ✗ | ✓ |
| Nonce-based replay protection | ✗ | ✓ |

## Rules

1. All attestations must use version 0x01. Other versions are rejected.
2. `pair` must be ASCII, exactly 32 bytes, null-padded if shorter than 32 bytes.
3. `price_denominator` must never be zero.
4. `timestamp` must be monotonic per `operator_id` — each attestation must have a timestamp ≥ the previous attestation from the same operator.
5. `nonce` must be strictly monotonic per `operator_id` — each attestation must have a nonce > the previous attestation from the same operator.
6. `operator_id` is the 32-byte x-coordinate of the operator's SECP256k1 compressed public key. The full 33-byte key (with parity prefix) is used only during signature verification and recovery.
7. Signature covers bytes 0–104 (105 bytes total), hashed with blake2b before signing.
8. Bundles must use the length-prefixed format (`count` + `attestation_size` + blobs). Concatenation without length prefix is not valid.
9. A verifying contract must check all five verification steps. Skipping any step (especially the registry check) makes the contract vulnerable to revoked operator attestations.
10. `block_height` must be ≤ the current block height. Attestations from the future are rejected.

## Reference

The author maintains a conforming implementation. This document defines the convention; an implementation demonstrates conformance.

Companion standards:

- **KCC-0011**: Conditional Token Standard — consumes attestations in `resolve()` and `check_and_transfer()`.
- **KCC-0013**: RWA Token Standard — uses attestations for NAV updates in `verify_asset()`.
- **KCC-0018**: Oracle Registry Covenant Convention — operator registration, bonding, and lifecycle.
- **KCC-0022**: ISDA Derivatives — consumes attestations for rate fixing (SOFR, EURIBOR, SONIA).
- **KCC-0023**: Lending — uses attestations for interest rate reference data.
