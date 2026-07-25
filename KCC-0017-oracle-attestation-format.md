# KCC-0017: Oracle Attestation Format

| Field | Value |
|-------|-------|
| **KCC** | 0017 |
| **Category** | Interoperability |
| **Title** | Oracle Attestation Format — Signed Price Data Standard |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |

## Abstract

A standard binary format for oracle-signed attestations. Defines the structure that every oracle operator signs and every covenant verifies. Enables any oracle operator to produce attestations that any covenant can consume, regardless of which oracle network they belong to.

## Motivation

Conditional tokens, commerce contracts, and price-gated transfers all depend on oracle attestations. Without a standard attestation format, every oracle network produces data in its own format and every covenant must be hard-coded to a specific oracle. This convention makes attestations interchangeable — a covenant written against this format can consume attestations from any compliant oracle.

## Attestation Structure

An attestation is a binary blob signed by the oracle operator's key. The signed payload is:

```
[version: 1 byte]
[pair: 32 bytes]          // "KAS/USD\0\0\0\0..." null-padded
[price_numerator: 8 bytes] // big-endian uint64
[price_denominator: 8 bytes] // big-endian uint64, 1 for direct prices
[timestamp: 8 bytes]       // Unix milliseconds, big-endian uint64
[block_height: 8 bytes]    // Kaspa block at time of observation
[nonce: 8 bytes]           // monotonic, operator-specific
[operator_id: 32 bytes]    // public key or covenant ID
[signature: 64 bytes]      // SECP256k1 signature over all preceding bytes
```

Total: 161 bytes.

### Fields

| Field | Bytes | Description |
|-------|:-----:|-------------|
| version | 1 | Format version (0x01) |
| pair | 32 | Trading pair, ASCII, null-padded |
| price_numerator | 8 | Price numerator, big-endian uint64 |
| price_denominator | 8 | Price denominator. 1 = direct price. e.g. for $0.02731: numerator=2731, denominator=100000 |
| timestamp | 8 | Observation time, Unix milliseconds |
| block_height | 8 | Kaspa block at observation |
| nonce | 8 | Monotonic, operator-specific |
| operator_id | 32 | Operator public key (32 bytes, SECP256k1 compressed) |
| signature | 64 | SECP256k1 signature over bytes 0-96 |

### Price Encoding

Prices are encoded as a rational number: numerator / denominator. This avoids floating-point errors and enables precise representation of any price.

Examples:
- KAS/USD = $0.02731 → numerator=2731, denominator=100000
- BTC/USD = $85,432.50 → numerator=8543250, denominator=100
- KAS/BTC = 0.00000032 → numerator=32, denominator=100000000

### Verification

A covenant verifies an attestation by:

1. **Format check**: version = 0x01, total length = 161 bytes
2. **Freshness check**: `block_height` must be within the covenant's max attestation age
3. **Pair match**: `pair` must match the expected trading pair
4. **Signature verification**: recover public key from `signature`, verify it matches `operator_id`
5. **Operator check**: `operator_id` must be ACTIVE in the Oracle Registry (per KCC-0001)

### Nonce

The nonce is a monotonically increasing counter per operator. Covenants may enforce `nonce_i > nonce_{i-1}` to prevent replay of old attestations. The nonce is operator-specific — different operators may have different nonce sequences.

## Attestation Bundles

Multiple attestations for different pairs may be bundled in one transaction. The format is simply concatenated attestation blobs. A covenant consuming the bundle parses each blob and selects the one matching its required pair.

## Oracle Registry Reference

This format references KCC-0018 (Oracle Registry) for operator registration and verification. A compliant oracle network must maintain an Oracle Registry covenant. Operators must be ACTIVE. Attestations must be signed with the operator's registry-linked SECP256k1 key.

## Convention Rules

1. All attestations must use version 0x01.
2. Pair names must be ASCII, null-padded to 32 bytes.
3. Price must be a rational number. Denominator must never be zero.
4. Timestamp must be monotonic per operator.
5. Nonce must be monotonic per operator.
6. Operator ID must be the compressed SECP256k1 public key (33 bytes, dropping the leading 0x02/0x03 prefix → 32 bytes).
7. Signature covers bytes 0-96 (everything before the signature field).