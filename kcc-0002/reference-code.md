# KCC2 reference code

This document illustrates KCC2 authority checks in current
[Silverscript](https://github.com/kaspanet/silverscript) and
[Argent](https://github.com/argent-lang/argent) syntax. It is non-normative;
KCC2 Sections 2 through 5 define the required semantics.

For signature schemes, the higher-level convention defines the signed message,
signature encoding, and witness layout.

## 1. Silverscript P2PK Schnorr

The following code verifies `p2pk-schnorr/v1`:

```js
function requireP2PKSchnorr(pubkey authority, sig signature) {
    require(checkSig(signature, authority));
}
```

## 2. Silverscript P2PKH Schnorr

The following code verifies `p2pkh-schnorr/v1`:

```js
function requireP2PKHSchnorr(
    byte[32] authority,
    pubkey publicKey,
    sig signature
) {
    byte[32] publicKeyHash = blake3WithKey(
        byte[](publicKey),
        byte[32](
            byte[]("PublicKeyHash") + byte[19](0x00000000000000000000000000000000000000)
        )
    );
    require(publicKeyHash == authority);
    require(checkSig(signature, publicKey));
}
```

## 3. Silverscript P2PKH ECDSA

The following code shows the intended verification of `p2pkh-ecdsa/v1`.
`checkSigECDSA` corresponds to Kaspa Script's `OP_CHECKSIGECDSA`, but may not be
supported by the Silverscript version in use:

```js
function requireP2PKHECDSA(
    byte[32] authority,
    byte[33] publicKey,
    sig signature
) {
    byte[32] publicKeyHash = blake3WithKey(
        byte[](publicKey),
        byte[32](
            byte[]("PublicKeyHash") + byte[19](0x00000000000000000000000000000000000000)
        )
    );
    require(publicKeyHash == authority);

    // May not be supported by the Silverscript version in use.
    require(checkSigECDSA(signature, publicKey));
}
```

## 4. Silverscript P2SH

The following code verifies a P2SH authority using an input index supplied by
the higher-level convention:

```js
function requireP2SH(byte[32] authority, int authorityInput) {
    byte[] expected = byte[](new ScriptPubKeyP2SH(authority)); // => 0x0000 OP_BLAKE2B OP_DATA_32 authority OP_EQUAL
    require(tx.inputs[authorityInput].scriptPubKey == expected);
}
```

## 5. Covenant-ID authority

The following Silverscript code performs the minimum `covenant-id/v1` approval
check:

```js
function requireCovenantId(byte[32] authority) {
    require(OpCovInputCount(authority) > 0);
}
```

### Argent reference code

Argent is a language and transpiler for multi-contract, multi-application
protocols built on Silverscript. It compiles Argent programs to Silverscript.
Cross-covenant introspection and state-transition validation are part of its
core domain, making Argent a natural higher-level example of KCC2 authority
schemes.

Argent's `cov_id.co_spent()` is a shortcut for the same minimum covenant-ID
approval check:

```js
require(cov_id(authority).co_spent());
```

When an application must validate how the authority covenant participates, an
Argent `observes` clause can authenticate its program template and inspect its
input and output state. For example:

```js
entry authorize()
observes remote by self.authority_id {
    inputs {
        before: Authority,
    }

    outputs {
        after: Authority,
    }
} {
    AuthorityState before = remote.inputs.before.state;
    require(before.enabled);

    require remote.outputs become {
        after <- Authority(before),
    };
}
```

Here the `observes` declaration requires the named authority input and output,
authenticates their `Authority` templates, exposes the decoded input state, and
validates the declared successor state.
