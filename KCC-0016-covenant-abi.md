# KCC-0016: Covenant ABI

| Field | Value |
|-------|-------|
| **KCC** | 0016 |
| **Category** | Interoperability |
| **Title** | Covenant ABI — Interface Discovery for Tooling |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |

## Abstract

A standard format for covenants to declare their interface — entrypoints, parameters, state fields, and metadata — so that explorers, wallets, DEXes, and indexers can auto-discover and interact with any covenant without manual integration. Complements the KCC-0020 descriptor format.

## Motivation

Without a standard interface declaration, every tool must be hand-coded for every covenant. A wallet cannot display token balances without knowing the state layout. A DEX cannot list a pair without knowing the transfer entrypoint signature. An explorer cannot decode a transaction without knowing parameter types. This convention makes every covenant self-describing.

## Specification

A Covenant ABI is a JSON document published alongside a covenant. It may be embedded in the descriptor (per KCC-0020) or served separately.

### ABI Structure

```json
{
  "covenant_id": "0xf3a...",
  "name": "GovernedToken",
  "version": 1,
  "entrypoints": [{
    "name": "transfer",
    "params": [
      {"name": "to", "type": "pubkey"},
      {"name": "amount", "type": "uint64"}
    ],
    "returns": "void",
    "description": "Transfer tokens to recipient"
  }],
  "state": [
    {"name": "owner", "type": "pubkey"},
    {"name": "balance", "type": "uint64"}
  ],
  "events": ["Transfer", "Approval", "Mint"],
  "extensions": ["kcc20_borrowed_receive_v1"],
  "metadata": {
    "author": "Vida Wallet",
    "license": "MIT",
    "repository": "https://github.com/..."
  }
}
```

### Type System

| Type | Description | JSON Encoding |
|------|-------------|---------------|
| `pubkey` | Kaspa public key | hex string |
| `uint8`-`uint64` | Unsigned integer | number |
| `bool` | Boolean | true/false |
| `bytes32` | 32-byte value | hex string |
| `enum` | Enumerated value | string name |
| `pubkey[]` | Array of public keys | array of hex strings |

### Entrypoint Signatures

Each entrypoint declares its parameters with types. This enables:

- **Wallets** to construct calls without knowing the covenant internally
- **Explorers** to decode transaction input data
- **DEXes** to discover which entrypoint is the transfer function
- **Indexers** to parse state changes from transaction outputs

### Event Declaration

Covenants declare which events they emit. Events are recorded on-chain via structured data in transaction outputs. Tooling indexes these for notifications and activity feeds.

## Convention Rules

1. The ABI must be published at the same time as the covenant.
2. Parameter types must use the standard type system defined above.
3. State field ordering in the ABI must match the on-chain ordering.
4. Events must be declared in the ABI to be considered part of the interface.
5. The ABI is versioned — breaking changes increment the version number.

## Relationship to Other Standards

- **KCC-0020**: The ABI can be embedded in or linked from the KCC-0020 descriptor. The descriptor defines encoding; the ABI defines semantics.
- **KCC-0008**: Multi-Token Standard covenants publish an ABI so wallets auto-detect token profiles.
- **kascov**: The covenant explorer reads ABIs to decode transaction data without per-covenant configuration.