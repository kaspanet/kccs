# KCC-0016: Covenant ABI — Interface Discovery

| Field | Value |
|-------|-------|
| **KCC** | 0016 |
| **Category** | Interoperability |
| **Title** | Covenant ABI — Interface Discovery for Tooling |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |
| **Depends on** | KCC-0008 (PR #10, draft) |
| **Updated** | 2026-07-25 |

## Abstract

A standard format for covenants to declare their interface — entrypoints, parameter types, state layout, and events — so that explorers, wallets, DEXes, and indexers can auto-discover and interact with any covenant without manual integration. The ABI maps high-level parameter types to Kaspa covenant binary encoding and is embedded in the covenant's deployment descriptor.

## Motivation

Without a standard interface declaration, every tool must be hand-coded for every covenant. A wallet cannot display token balances without knowing the state layout. A DEX cannot list a pair without knowing the transfer entrypoint signature. An explorer cannot decode a transaction without knowing parameter types. This convention makes every covenant self-describing.

KCC-0020 defines a descriptor with `state_layout` and entrypoint selectors. This convention extends that pattern: the ABI provides the complete type information needed to construct and decode covenant calls without access to the SilverScript source.

## Specification

### ABI Location

The ABI is embedded in the covenant's deployment descriptor as a `covenant_abi` field containing a serialized binary structure. Wallets and indexers read the descriptor to discover the covenant's interface.

For KCC-0008-style descriptors, the ABI is an additional field:

```
KCC0008Descriptor {
    ...
    covenant_abi: bytes          // serialized CovenantABI (see below)
}
```

### ABI Structure

The Covenant ABI is a binary structure serialized as:

```
offset  size    field                   encoding
0       4       magic                   bytes4 ("KABI" — Kaspa ABI)
4       2       version                 uint16, big-endian (0x0001)
6       2       entrypoint_count        uint16, big-endian
8       2       state_field_count       uint16, big-endian
10      2       event_count             uint16, big-endian
12      var     entrypoints             EntrypointDef[entrypoint_count]
var     var     state_fields            StateFieldDef[state_field_count]
var     var     events                  EventDef[event_count]
```

#### EntrypointDef (variable length)

```
offset  size    field               encoding
0       1       name_len            uint8 (length of entrypoint name)
1       var     name                ASCII bytes
var     1       param_count         uint8
var     var     params              ParamDef[param_count]
var     1       selector            uint8 (compiled entrypoint ID)
```

#### ParamDef (9 bytes each)

```
offset  size    field               encoding
0       1       name_len            uint8
1       var     name                ASCII bytes
var     1       param_type          uint8 (see Type System)
var     1       array_depth         uint8 (0 = scalar, 1 = T[], 2 = T[][])
var     1       size                uint8 (byte width for fixed types: 1, 2, 4, 8, 32, 64)
```

#### StateFieldDef (variable length)

```
offset  size    field               encoding
0       1       name_len            uint8
1       var     name                ASCII bytes
var     2       offset              uint16, big-endian (byte offset in state)
var     2       size                uint16, big-endian (byte size)
var     1       field_type          uint8 (see Type System)
```

#### EventDef (variable length)

```
offset  size    field               encoding
0       1       name_len            uint8
1       var     name                ASCII bytes
var     1       topic_count         uint8 (indexed parameters)
var     var     topic_indices       uint8[topic_count]
var     1       data_param_count    uint8
var     var     data_params         ParamDef[data_param_count]
```

### Type System

Parameters map to covenant binary encoding as follows:

| Type ID | Name | Binary Encoding | Wire Size |
|:---:|------|-----------------|:---:|
| 0x00 | `bool` | 0x00 or 0x01 | 1 |
| 0x01 | `uint8` | Unsigned 8-bit integer | 1 |
| 0x02 | `uint16` | Big-endian unsigned 16-bit integer | 2 |
| 0x03 | `uint32` | Big-endian unsigned 32-bit integer | 4 |
| 0x04 | `uint64` | Big-endian unsigned 64-bit integer | 8 |
| 0x05 | `bytes32` | Fixed 32-byte value | 32 |
| 0x06 | `bytes64` | Fixed 64-byte value (padded) | 64 |
| 0x07 | `pubkey` | SECP256k1 public key (compressed, 33 bytes) | 33 |
| 0x08 | `sig` | SECP256k1 signature (r \|\| s, 64 bytes) | 64 |
| 0x09 | `State[]` | Array of covenant state structs | variable |
| 0x0A | `byte[]` | Variable-length byte array | variable |
| 0x0B | `bytes` | Variable-length bytes (length-prefixed: uint16 + data) | 2 + N |
| 0x0C | `enum` | Single-byte discriminant | 1 |

For array types (`array_depth > 0`), the wire format is: `[element_count: uint16, big-endian] [element_0] [element_1] ...`.

For `State[]`, items are serialized per the covenant's state layout using the `state_fields` definitions.

### Example: KCC-0008 transfer()

The KCC-0008 `transfer` entrypoint ABI:

| Param | Type | Array | Description |
|-------|------|:---:|-------------|
| next_states | State[] | 1 | Successor covenant states (KCC-0008 147-byte header) |
| signatures | sig | 1 | Authorization signatures, positional |
| witnesses | byte[] | 1 | Per-input witness metadata |

Serialized as:

```
EntrypointDef:
  name: "transfer" (8 bytes)
  params[0]: name="next_states", type=State[], size=147
  params[1]: name="signatures", type=sig[], size=64
  params[2]: name="witnesses", type=byte[], size=1
  selector: <compiled entrypoint ID>
```

### Example: KCC-0010 set_fee_schedule()

```
EntrypointDef:
  name: "set_fee_schedule" (17 bytes)
  params[0]: name="recipient_ids", type=bytes32[], size=32
  params[1]: name="bps_values", type=uint16[], size=2
  selector: <compiled entrypoint ID>
```

### Encoding Parameter Data

When constructing a covenant call, parameters are serialized in declaration order:

1. Scalar types: encoded directly per the Type System table.
2. Fixed-size array (e.g., `bytes32[3]`): 96 bytes, concatenated.
3. Variable-length array (e.g., `bytes32[]`): `[count: uint16] [item_0] ... [item_count-1]`.
4. `State[]`: each state struct serialized per the covenant's state layout, with `[count: uint16]` prefix.

All multi-byte integers are big-endian. All byte arrays are packed without padding.

### Events

Events are recorded on-chain via structured data in transaction outputs. Each event produces a covenant output UTXO with:

```
offset  size    field               encoding
0       1       event_index         uint8 (index into the ABI's events array)
1       1       topic_count         uint8
2       var     topics              bytes32[topic_count]
var     1       data_param_count    uint8
var     var     data                serialized per data_params
```

**Topics** are indexed parameters (like Ethereum's indexed event params). Indexers filter by topic. **Data** parameters are the event payload.

Events do not have return values. They are covenant outputs that indexers observe. The event UTXO may be pruned after indexing — it serves no ongoing covenant function.

### Discovery

A wallet or indexer discovers a covenant's ABI by:

1. Reading the covenant's deployment descriptor (published alongside the covenant).
2. Extracting the `covenant_abi` field.
3. Parsing the binary structure per the layout above.
4. Using the parsed entrypoints, state fields, and events to:
   - Display token balances (via `state_fields`)
   - Construct transaction sigscripts (via `entrypoints` and `ParamDef`s)
   - Decode transaction outputs (via `state_fields`)
   - Index events (via `EventDef`s)

### KCC-0020 Alignment

This convention extends KCC-0020's descriptor format with type information for tooling.

| Feature | KCC-0020 | KCC-0016 |
|---------|:---:|:---:|
| Descriptor prefix/suffix | ✓ | ✓ (embeds in descriptor) |
| State layout declaration | ✓ (field names) | ✓ (field names + types + offsets) |
| Entrypoint selectors | ✓ | ✓ (adds param types) |
| Parametric type system | ✗ | ✓ |
| Event declaration | ✗ | ✓ |
| Binary serialization format | ✗ | ✓ |
| Big-endian encoding | ✓ | ✓ |

### Composability

ABIs compose with:

- **KCC-0008** (Multi-Token Standard): covenant deployments include the ABI in their descriptor, enabling auto-discovery of token types and profiles.
- **KCC-0018** (Oracle Registry): operator registration includes the ABI so verifying contracts can discover the registry's verification interface.
- **All KCCs**: any KCC that defines covenant entrypoints should publish an ABI alongside its deployment.

## Rules

1. The ABI must be published at the same time as the covenant deployment.
2. Parameter types must use the standard type system defined above.
3. State field ordering in the ABI must match the on-chain state layout.
4. `param_count` must match the actual number of entrypoint parameters.
5. `selector` must match the compiled entrypoint ID in the covenant script.
6. Events declared in the ABI must match the events produced by the covenant.
7. The ABI is versioned — breaking changes increment the version number.
8. The ABI magic bytes must be `"KABI"` (0x4B414249).
9. All multi-byte integers are big-endian.
10. Tooling must reject ABIs with `magic != "KABI"` or `version > 0x0001` (unknown format).

## Reference

The author maintains a conforming implementation. This document defines the convention; an implementation demonstrates conformance.

Companion standards:

- **KCC-0001**: Covenant definition and canonical state encoding (IzioDev).
- **KCC-0008**: Multi-Token Standard — descriptor format extended by this ABI convention.
- **KCC-0020**: KCC-0020 descriptor with prefix/suffix and entrypoint selectors.
