KCC: 4
Title: Slashable Bond Covenant
Description: A bond a worker funds that refunds after a deadline or slashes to a buyer on a referee's signed verdict.
Authors: Kaspa-World-Eater
Comments-URI: https://kas-smiths.org/t/three-covenant-kccs-for-reputation-bonds-and-identity-live-on-testnet-10/148
Status: Draft
Type: Standards Track
Category: Covenant
Created: 2026-09-20
Requires: 1, 2

## Abstract

This KCC specifies a Slashable Bond: a covenant a worker funds up front that has exactly two ordinary ways out and one composed way out. The worker may reclaim the bond after a deadline; a referee may slash it to a named buyer with a signature over a digest that commits to the payout output, so consensus enforces where the money goes; and a single referee signature may, in one transaction, both slash the bond and advance a Reputation Deed. The bond is what makes a claim like "I did the work" cost something to fake.

## Motivation

Paying strangers for work no one can cheaply re-verify (compute, rendering, delivery) needs a stake the worker forfeits when a referee catches it lying. A plain escrow releases only to preset parties on preset conditions; it cannot let a third party's signed ruling redirect the money, which is exactly what an adjudicated bond requires. Toccata introspection lets a covenant read its own transaction's outputs, so the slash door can verify the payout output matches what the referee signed. Standardising the digests and the doors lets any market, and any reputation system, use the same bond without bespoke integration.

## Specification

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as described in RFC 2119 and RFC 8174. Throughout, `le64(x)` denotes 8 byte little endian, equal to the covenant's `OpNum2Bin(x, 8)`, and `||` denotes byte concatenation.

A Slashable Bond is a Standards Track Covenant conforming to the ABI of KCC-1 and using authorities as defined by KCC-2. It is held at a P2SH address per KCC-1 Section 7. The bond is spent once, through one entrypoint; it carries no mutable state and therefore has no state region.

### Parameters

The bond binds five values into its program (template values, not state):

```
worker        : pubkey    32-byte x only Schnorr key, reclaims after the deadline
buyer         : pubkey    32-byte x only Schnorr key, receives a slash
referee       : pubkey    32-byte x only Schnorr key, whose verdict slashes
taskId        : byte[8]   the task this bond was posted for
deadlineBytes : byte[8]   le64 milliseconds; before this time, refund MUST fail
```

Each key is an authority under KCC-2 scheme `0x00` (`p2pk-schnorr/v1`).

### Digests

```
guiltyDigest  = BLAKE3( taskId || buyer || le64(out0.value) || out0.spk )
verdictDigest = BLAKE3( le64(out0.value) || out0.spk || le64(out1.value) || out1.spk )
```

`outN.spk` is the serialized scriptPublicKey (2 byte little endian version, then script) as KIP-10 `OpTxOutputSpk` pushes it, recomputed by the covenant from the real outputs. A buyer paid to P2PK has `scriptPublicKey = 0x0000 || OP_DATA_32 || buyerKey || OP_CHECKSIG`, that is `00 00 20 <key32> ac`. `verdictDigest` is identical to the one in the Reputation Deed KCC; it is the shared value that composes the two covenants.

### Entrypoints

Each entrypoint's dispatch tag is `BLAKE3(FunctionSignature)[0:4]` per KCC-1 Section 6.1, where `FunctionSignature` is the exact string given below. All tags MUST be distinct.

1. `refund(sig workerSig)` — signature `refund(sig)`, tag `17a2027b`. Returns the bond to the worker. It MUST enforce that the transaction's time is at or after the deadline (`tx.time >= temporal(int(deadlineBytes))`), and that `workerSig` is a valid signature by `worker`. Before the deadline this entry MUST fail.

2. `slash(datasig verdictSig)` — signature `slash(datasig)`, tag `aa853a8e`. Moves the bond to the buyer. It MUST enforce that the transaction has exactly one output, and that `verdictSig` is a valid signature by `referee` over `guiltyDigest`. Because `guiltyDigest` commits to `out0.value` and `out0.spk`, the referee's signature pins the amount and destination of the single output; a verdict signature MUST NOT be reusable for a different amount or destination. The referee computes `guiltyDigest` with `out0.spk` set to the buyer's scriptPublicKey when ruling guilty.

3. `slashAndDing(datasig verdictSig)` — signature `slashAndDing(datasig)`, tag `8b82e976`. Performs the slash atomically with a Reputation Deed ding. It MUST enforce all of:
   - the transaction has exactly two outputs;
   - `out0.spk` equals the buyer's P2PK scriptPublicKey (`00 00 20 <buyerKey> ac`);
   - `verdictSig` is a valid signature by `referee` over `verdictDigest`, which commits to BOTH outputs.
   Output 0 is the bond slash to the buyer; output 1 is the continuation of a Reputation Deed with its `bad` counter incremented by one (see the Reputation Deed KCC). The bond covenant and the deed covenant each recompute `verdictDigest` from the real outputs via KIP-10 introspection, so neither reads the other's program; the shared signature over the shared outputs is the entire binding. For that shared signature to satisfy both, the bond's `referee` MUST equal the deed's `authority`.

### Signature script

A spend's signature script is `PushArguments(args) || OP_DATA_4 dispatch_tag || PushMinimal(program)` per KCC-1 Section 7: the single signature argument, then the 4 byte dispatch tag, then the bond program.

## Rationale

Committing the payout output into the slash digest, rather than trusting the spender to send the money to the right place, is the whole point: consensus, not good behaviour, enforces the destination. `slash` keeps a single output and lets the digest pin it, so nothing can be skimmed to a third address; `slashAndDing` needs two outputs, so it additionally requires output 0 to be exactly the buyer's P2PK, since the deed occupies the digest's second half. A deadline expressed as le64 milliseconds and checked against the transaction time gives the worker an unconditional exit if no verdict ever comes, without a third party. Doing the slash and the ding in one transaction, under one signature the deed also checks, makes a penalty and a reputation mark land together or not at all. Field order in both digests is fixed so independent implementations produce identical signatures.

Alternatives considered: a 2-of-3 multisig escrow (rejected, it cannot bind the payout output, so a colluding pair can redirect funds); a time lock only bond with no adjudication (rejected, it cannot punish fraud, only abandonment); separate slash and ding transactions (rejected, non atomic).

## Backwards Compatibility

New convention, no incompatibility. A change to the parameters, doors, or digests yields a different P2SH address and is a different, non interoperable bond.

## Conformance Vectors

Produced by the reference implementation.

Entry signatures and dispatch tags (`tag = BLAKE3(signature)[0:4]`):

```
refund(sig)          : 17a2027b
slash(datasig)       : aa853a8e
slashAndDing(datasig): 8b82e976
```

`p2pkScriptPubKey(buyer)` with `buyer = 0x22..(32 bytes)`:

```
0000202222222222222222222222222222222222222222222222222222222222222222ac
```

`guiltyDigest` with `taskId = 0xcc..(8 bytes)`, `buyer = 0x22..(32)`, `out0.value = 99000000`, `out0.spk` as above:

```
f6fc91c4ffa506af58a644dc4f51fa9968d8d15406de7678a384ed06bfcd49ce
```

`deadlineBytes`, le64 of `1700000000000` milliseconds:

```
0068e5cf8b010000
```

The `verdictDigest` vector is given in the Reputation Deed KCC (the two share it).

## Reference Implementation

Implemented and proven live on testnet-10, both ordinary doors with their refusals (an early refund and a redirected slash both rejected by consensus) and the atomic slash-and-ding, in the quorum repository:

```
contracts/quorum-bond.sil     the covenant (constructor and three entries above)
src/bond.ts                    guiltyDigest, verdictDigest, p2pkScriptPubKey
src/bondtx.ts                  parameters, dispatch tags, deadline encoding, witness order
src/bond.test.ts              offline golden vectors
```

## Security Considerations

The referee is trusted to rule honestly; the covenant enforces only that a slash is signed by the referee and pays the committed output, not that the ruling is correct. Applications SHOULD choose a referee appropriate to the trust model and SHOULD publish it. The deadline is the worker's safety valve: implementations MUST check `tx.time` against the deadline correctly, since a bug that allows an early refund lets a worker escape a pending verdict, and a bug that never allows refund strands the bond. Because `guiltyDigest` and `verdictDigest` bind the outputs, a captured verdict signature cannot be pointed at a different payee or amount, but it remains valid for the exact outputs it commits to; a referee MUST treat signing a verdict as authorising that exact slash. In `slashAndDing`, the two output ordering (slash at 0, deed at 1) is normative and the referee MUST equal the deed's authority; an implementation MUST verify both outputs and MUST NOT compose a bond and deed whose referee and authority differ, or the atomicity guarantee is lost.

## Copyright

Copyright and related rights waived via CC0.
