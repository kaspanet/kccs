KCC: 3
Title: Reputation Deed Covenant
Description: A covenant holding a monotonic good and bad tally that a named authority advances one mark at a time.
Authors: Kaspa-World-Eater
Comments-URI: https://kas-smiths.org/t/three-covenant-kccs-for-reputation-bonds-and-identity-live-on-testnet-10/148
Status: Draft
Type: Standards Track
Category: Covenant
Created: 2026-09-20
Requires: 1, 2

## Abstract

This KCC specifies a Reputation Deed: a covenant that holds a stable identity and two monotonic counters, `good` and `bad`, which only a named authority may advance, one mark at a time. Each advance is authorised by a signature over a digest that binds the deed's current tally, so an attestation is single use and cannot be replayed once the counters move. The tally is self proving on chain; the reputation number it means is computed off chain from the same two counters by anyone who reads the deed.

## Motivation

Kaspa applications that pay strangers (compute markets, delivery networks, streaming) need a portable record of "has this participant behaved" that no party can forge or silently rewrite. A private reputation table inside one application does not transfer and can be edited by whoever hosts it. Putting the tally in a covenant makes it public, append only, and readable by every application at once, so the same participant carries one honest history across the whole ecosystem. Standardising the byte layout and the authority digest lets independent tools produce and read the same deeds without coordinating out of band.

## Specification

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as described in RFC 2119 and RFC 8174.

A Reputation Deed is a Standards Track Covenant conforming to the ABI of KCC-1 and using an authority as defined by KCC-2. It is held at a P2SH address committing to its program per KCC-1 Section 7. Throughout, `le64(x)` denotes 8 byte little endian, equal to the covenant's `OpNum2Bin(x, 8)`, and `||` denotes byte concatenation.

### Parameters and state

The deed is parameterised by one template value and initialised with four:

```
authority : pubkey    32-byte x only Schnorr key, the adjudicator (template value)
```

`authority` is an authority under KCC-2 scheme `0x00` (`p2pk-schnorr/v1`). It is a template value and MUST NOT be carried in state.

The state, encoded per KCC-1 Section 8 (PushExplicit) and occupying a contiguous `state.start` / `state.len` region, is the ordered tuple:

```
participantId : byte[32]   pushed as 0x20 || participantId
owner         : byte[32]   pushed as 0x20 || owner
good          : int        pushed as 0x08 || le64(good)
bad           : int        pushed as 0x08 || le64(bad)
```

The region is therefore exactly 84 bytes. `good` and `bad` MUST be non negative and MUST advance monotonically; a continuation MUST NOT decrease either counter. `participantId` is a 32 byte identity to which the reputation attaches; its minting is out of scope here and is specified by the Deed Identity Registry KCC. `owner` is `blake2b-256(ownerPubkey)` and authorises retirement.

### Digests

```
attestDigest(outcome) = BLAKE3( participantId || le64(good) || le64(bad) || le64(outcome) )
verdictDigest         = BLAKE3( le64(out0.value) || out0.spk || le64(out1.value) || out1.spk )
```

`out0` and `out1` are the transaction's outputs 0 and 1; `outN.spk` is the serialized scriptPublicKey (2 byte little endian version, then script) as KIP-10 `OpTxOutputSpk` pushes it. Both digests are computed by the covenant from its own state and the transaction's outputs via KIP-10 introspection. `verdictDigest` is identical to the one in the Slashable Bond KCC; it is the shared value that composes the two covenants (see `dingByVerdict`).

### Entrypoints

Each entrypoint's dispatch tag is `BLAKE3(FunctionSignature)[0:4]` per KCC-1 Section 6.1, where `FunctionSignature` is the exact string given below. All tags MUST be distinct.

1. `attest(datasig authoritySig, int outcome)` — signature `attest(datasig,int)`, tag `14cab282`. Advances the tally by one mark. It MUST enforce all of:
   - `outcome` is `1` (a good mark) or `0` (a bad mark);
   - `authoritySig` is a valid signature by `authority` over `attestDigest(outcome)` computed at the deed's CURRENT `(good, bad)`;
   - the transaction has exactly one output;
   - `out0.value + 1000000 >= input.value`, that is the fee taken from the deed MUST NOT exceed 1000000 sompi (0.01 KAS);
   - output 0 continues the deed at the same P2SH address, preserving `authority`, `participantId`, and `owner`, with `good` incremented by one if `outcome == 1`, otherwise `bad` incremented by one, and the other counter unchanged (KCC-1 Section 8.5 template authentication).

2. `dingByVerdict(datasig verdictSig)` — signature `dingByVerdict(datasig)`, tag `03adc221`. Increments `bad` by one under a shared verdict, enabling atomic composition with a slashable bond. It MUST enforce all of:
   - the transaction has exactly two outputs;
   - `verdictSig` is a valid signature by `authority` over `verdictDigest`;
   - output 1 continues the deed, preserving `authority`, `participantId`, and `owner`, with `bad` incremented by one and `good` unchanged.
   The deed's continuation is output 1 because output 0 is reserved for the co-spent bond's slash. For the shared signature to satisfy both covenants, the bond's referee MUST equal this deed's `authority` (see the Slashable Bond KCC).

3. `retire(sig ownerSig, pubkey ownerPk)` — signature `retire(sig,pubkey)`, tag `f14387b1`. Ends the deed. It MUST enforce that `blake2b-256(ownerPk) == owner` and that `ownerSig` is a valid signature by `ownerPk`. A retire spend MUST NOT be required to continue the deed.

### Reputation score (informational)

The number the tally means is computed OFF chain and is not part of consensus:

```
score = (good + 1) / (good + bad + 2)
```

This Laplace smoothed success rate lies in the open interval (0, 1); a deed with no history reads exactly 0.5. Readers MAY use another estimator, but SHOULD document it, since the covenant standardises the evidence, not its interpretation.

### Signature script

A spend's signature script is `PushArguments(args) || OP_DATA_4 dispatch_tag || PushMinimal(program)` per KCC-1 Section 7: the ordered entry arguments, then the 4 byte dispatch tag, then the deed program. For `attest` the arguments are `authoritySig` then `outcome`; for `dingByVerdict`, `verdictSig`; for `retire`, `ownerSig` then `ownerPk`.

## Rationale

Two monotonic counters, rather than a single score, keep consensus free of floating point and of any opinion on how to weigh evidence: the chain holds facts (this many good, this many bad), and reading is left to the application. Binding the current tally into the attestation digest, rather than adding a nonce, gives replay protection for free and needs no extra state. Keeping the authority in the template while identity lives in state lets a registry mint fresh deeds from one compiled program while each deed still rotates its address on both identity and tally. The fee cap on `attest` keeps a continuation from bleeding the deed's own value away as fees over many marks. `dingByVerdict` is checked against the same `authority` that signs attestations so that one adjudicator's single signature can both slash a bond and ding a deed atomically, which is what makes a bad mark cost something rather than being cheap to hand out.

Alternatives considered: a signed off chain reputation feed (rejected, it is forgeable and non transferable); storing the score on chain (rejected, floating point and premature policy); a monotonic single net counter (rejected, it loses the sample size the score needs).

## Backwards Compatibility

This is a new convention and introduces no incompatibility. Deeds are identified by their P2SH address; a change to the layout, digests, or dispatch tags produces different addresses and is a different, non interoperable convention.

## Conformance Vectors

Produced by the reference implementation.

Entry signatures and dispatch tags (`tag = BLAKE3(signature)[0:4]`):

```
attest(datasig,int)     : 14cab282
dingByVerdict(datasig)  : 03adc221
retire(sig,pubkey)      : f14387b1
```

`attestDigest`, with `participantId = 0x11..(32 bytes)`:

```
good=3 bad=1 outcome=1 : a4e75b172800da7c9abf2efec3f010d1a6f2c23ed4a2571b65e1f44061389336
good=0 bad=0 outcome=0 : 993e4c9b67fed12f4aebf728c9a6e7fb9b3deb9c5b95301437604fb5ade53f1e
```

`verdictDigest`, with `out0 = {value 99000000, spk 0x20..(18 bytes)}`, `out1 = {value 0, spk 0x21..(18 bytes)}`:

```
4f0fa669405ba5a12e96188c9b13a178957d03a747f12393c83d24255ffc012d
```

`score = (good + 1) / (good + bad + 2)`:

```
good=0  bad=0 : 0.5
good=3  bad=1 : 0.6666666666666666
good=10 bad=0 : 0.9166666666666666
good=1  bad=9 : 0.16666666666666666
```

State field encodings (PushExplicit):

```
good=3 : 080300000000000000
bad=1  : 080100000000000000
```

## Reference Implementation

A complete implementation, proven live on testnet-10 (the continue verb and a replay refusal both broadcast end to end), is in the quorum repository:

```
contracts/reputation-deed-v2.sil   the covenant (constructor and three entries above)
src/deed.ts                        attestDigest, verdictDigest, reputationScore
src/deedv2.ts                      state layout, dispatch tags, witness order
src/deed.test.ts, deedv2.test.ts   the vectors above
```

## Security Considerations

The authority is fully trusted to advance the tally honestly; a Reputation Deed does not constrain WHAT the authority attests, only that each mark is signed and single use. Applications SHOULD choose an authority appropriate to the trust model (a market operator, a multi party scheme under KCC-2, or a covenant lineage) and SHOULD publish it. Because `attestDigest` binds the current `(good, bad)`, a signature captured in flight cannot be replayed after the tally moves, but a signature is valid until the counters advance; an application that signs speculatively MUST assume the mark may land. Monotonic counters mean a deed can only be added to, never rewritten, so a hostile authority can inflate or deflate a participant but cannot erase the deed's history; observers MAY weigh a deed by the identity of its authority. In `dingByVerdict`, the deed's continuation MUST be output 1 and the bond's slash output 0; an implementation that composes the two MUST fix that ordering, and MUST set the bond's referee equal to this deed's authority, or the shared signature will not validate. Retirement is controlled solely by `owner`; loss of the owner key strands the deed but cannot forge marks.

## Copyright

Copyright and related rights waived via CC0.
