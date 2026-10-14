KCC: 5
Title: Deed Identity Registry
Description: A covenant that mints a reputation deed with a fresh identity derived from the spent registration outpoint.
Authors: Kaspa-World-Eater
Comments-URI: https://kas-smiths.org/t/three-covenant-kccs-for-reputation-bonds-and-identity-live-on-testnet-10/148
Status: Draft
Type: Standards Track
Category: Covenant
Created: 2026-09-20
Requires: 1, 2, 3

## Abstract

This KCC specifies a Deed Identity Registry: a covenant, pinned to exactly one Reputation Deed template, that any caller may spend to mint a new deed with a fresh, unforgeable identity. The identity is derived on chain from the registration outpoint the caller spends, so every minted identity is unique and no caller can choose or forge one. The registry recreates itself on each mint, so it is a permanent, permissionless faucet for identities under one adjudicator.

## Motivation

A Reputation Deed attaches a tally to a 32 byte `participantId`, but does not say where that id comes from. If identities were caller chosen, a participant could grind a favourable id or impersonate another; if they came from a mutable counter, minting could race. Deriving the id from a spent outpoint reuses the ledger's own uniqueness: an outpoint can be spent once, so an id minted from it is unique and its minting is witnessed by consensus. Standardising this lets any application recognise deeds minted by a known registry and predict a deed's address before it is created.

## Specification

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as described in RFC 2119 and RFC 8174. Throughout, `le64(x)` denotes 8 byte little endian and `||` denotes byte concatenation.

A Deed Identity Registry is a Standards Track Covenant conforming to the ABI of KCC-1. It is held at a P2SH address per KCC-1 Section 7. It carries one template value and no mutable state:

```
deedTemplate : byte[32]   the template hash of the Reputation Deed this registry mints
```

### Binding to a deed template

`deedTemplate` commits to exactly one deed template by the KCC-1 Section 8.3 hash:

```
deedTemplate = BLAKE3( le64(len(prefix)) || prefix || le64(len(suffix)) || suffix )
```

where `prefix` and `suffix` are the Reputation Deed program either side of its state region (see the Reputation Deed KCC), with the deed's `authority` already bound in. A registry therefore mints deeds under one fixed adjudicator and one fixed program shape; it MUST NOT mint any program whose template does not hash to `deedTemplate`.

### Entrypoint

`register(sig ownerSig, pubkey ownerPk, byte[] deedPrefix, byte[] deedSuffix)` — signature `register(sig,pubkey,byte[],byte[])`, dispatch tag `BLAKE3(FunctionSignature)[0:4] = e35eb08d`.

A `register` spend MUST enforce all of:

1. `ownerSig` is a valid signature by `ownerPk`. Let `owner = blake2b-256(ownerPk)`.
2. Let the registration input be the input spending this registry (`this.activeInputIndex`). Derive
   ```
   participantId = blake2b-256( "DeedRegistry.participantId" || txid || index )
   ```
   where `txid` is that input's outpoint transaction id (`OpOutpointTxId`), `index` is its outpoint index as 4 byte little endian (`OpOutpointIndex`), and the domain string is ASCII with no separator or terminator.
3. The spend declares exactly two KIP-20 authority outputs for this input (`OpAuthOutputCount == 2`).
4. Authority output 0 recreates the registry verbatim: its scriptPublicKey and value equal the registry input's scriptPublicKey and value, so the lane persists unchanged for the next mint.
5. Authority output 1 is a fresh deed, built by `validateOutputStateWithTemplate` from `deedPrefix`, `deedSuffix`, and `deedTemplate` (which the supplied prefix and suffix MUST hash to), with state `participantId` as derived above, `owner` as above, `good = 0`, and `bad = 0`.

Minting is otherwise permissionless: any caller who provides an owner key and a spendable registration input may mint.

### Signature script

A spend's signature script is `PushArguments(ownerSig, ownerPk, deedPrefix, deedSuffix) || OP_DATA_4 e35eb08d || PushMinimal(program)` per KCC-1 Section 7.

## Rationale

Using the spent outpoint as the seed makes identity uniqueness a consequence of the UTXO model rather than a property the covenant must police: two mints cannot share an id without double spending an outpoint. A domain separated BLAKE2b keeps the id from colliding with any other use of the same outpoint bytes. Pinning the registry to one template hash, rather than accepting an arbitrary program, is what stops a registry from being tricked into minting a deed with a different authority or a pre loaded tally. Passing the deed prefix and suffix as arguments, rather than embedding the whole deed program, keeps the registry within the KCC-1 element size limit while still binding what it mints. Using KIP-20 authority outputs, rather than fixed output indices, lets the mint sit anywhere in a larger transaction while still naming exactly which two outputs the registry governs.

Alternatives considered: a caller chosen id (rejected, forgeable and grindable); a monotonic on chain counter (rejected, mint races and needs mutable state); embedding the full deed program in the registry (rejected, exceeds the element size limit).

## Backwards Compatibility

New convention, no incompatibility. A registry is recognised by its address, which commits to its `deedTemplate`; a different template or derivation is a different, non interoperable registry.

## Conformance Vectors

Produced by the reference implementation.

Entry signature and dispatch tag (`tag = BLAKE3(signature)[0:4]`):

```
register(sig,pubkey,byte[],byte[]) : e35eb08d
```

`deedTemplate` for a deed under `authority = 0xa1..(32 bytes)`:

```
3928f7d74cf940a05b1b047c0d8b97da4411cd34587d78628e81550b5934b273
```

`participantId` for registration outpoint `txid = 0x33..(32 bytes)`, `index = 0`:

```
9b2c32f5b148cbc02cd34e8f00d7910759520e35de17034538c3ca8550b3bded
```

## Reference Implementation

Implemented and proven live on testnet-10 (a registry minting a fresh deed) in the quorum repository:

```
contracts/deed-registry.sil    the covenant (constructor and register entry above)
src/registrytx.ts              deedTemplate hash, participantId derivation, dispatch tag
src/registrytx.test.ts         the vectors above
```

## Security Considerations

A registry can only mint the one deed template it commits to, so a caller cannot use it to create a deed under a different authority or with a non zero starting tally. Identity uniqueness rests entirely on outpoint uniqueness; an implementation MUST derive `participantId` from an outpoint the spend actually consumes, not from caller supplied bytes, or the uniqueness guarantee is lost. Recreating the registry lane MUST preserve both its scriptPublicKey and its value, or a mint could drain or divert the lane. Minting is permissionless by design; an application that wants gated minting SHOULD place the gate in the registration input it requires, not in this covenant. The minted deed's owner is set to `blake2b-256(ownerPk)` from the caller, so a caller can only mint deeds it can later retire, and cannot set another party as owner without that party's key.

## Copyright

Copyright and related rights waived via CC0.
