# KCC20 Borrowed Receive Authorization

Borrowed Receive is defined in
[KCC20 Section 5](../kcc-0020.md#5-borrowed-receive).

## Motivation

[KIP-9](https://github.com/kaspanet/kips/blob/master/kip-0009.md) prices UTXO-set
growth through storage mass, which rises for small-valued new outputs.

For token transfers, this means the sender normally funds each new recipient
token UTXO with enough KAS, or the recipient co-signs and supplies an existing
UTXO.

Borrowed Receive allows the sender to use an existing recipient KCC20 UTXO as
the receive target. Instead of creating a new recipient token UTXO, the sender
consumes the existing UTXO and recreates it in place with a larger token amount.
The recipient's normal owner authorization is not used, the KAS value cannot
decrease, and the owner and extended state remain unchanged.

Because a borrowed receive consumes and recreates an existing UTXO, it changes
that UTXO's outpoint. A wallet that did not expect the borrow may need to
synchronize and discover the successor before using its recorded UTXO.

Unrestricted borrowing also enables outpoint-churn spam. An attacker can
repeatedly recreate the UTXO through token-dust transfers, continually changing
its outpoint and invalidating transactions constructed to spend the previous
one.

## Borrow authorization

Each KCC20 state contains a `borrow_scheme` and a 32-byte `borrow_guard`.
`borrow_scheme` selects the authorization rule, while `borrow_guard` holds its
parameter or evolving state.

Some schemes require a scheme-specific `borrow_witness`.

| Scheme | Control model | `borrow_guard` | `borrow_witness` |
| --- | --- | --- | --- |
| `disabled/v1` | No borrowing | Unused | Borrowing is rejected |
| `amount-threshold/v1` | Any sender above threshold | Threshold in first eight bytes | Empty |
| `schnorr-signature/v1` | Approved borrower, reusable | Dedicated 32-byte public key | 65-byte Schnorr transaction signature |
| `hash-chain/v1` | Approved borrow, single-use | Current 32-byte hash-chain commitment | 32-byte preimage, 32-byte one-time public key, and 65-byte signature |

Every borrowed receive preserves `borrow_scheme`. A normal owner-authorized
transfer may replace both `borrow_scheme` and `borrow_guard`.

### `disabled/v1`

The `disabled/v1` scheme rejects borrowed receives.

### `amount-threshold/v1`

The `amount-threshold/v1` scheme allows any sender to borrow when the token
increase exceeds the threshold stored in `borrow_guard`. A positive threshold
mitigates dust-based outpoint churn; a zero threshold allows any positive
increase. No `borrow_witness` is required.

### `schnorr-signature/v1`

The `schnorr-signature/v1` scheme allows the holder of a dedicated borrow key to
authorize repeated borrows. Each borrow requires a valid transaction signature.
The key cannot spend the recipient's tokens or reduce the UTXO's KAS value.

### `hash-chain/v1`

The `hash-chain/v1` scheme allows one borrow per released chain link. Each link
is a one-time authorization bound to its own signing key and advances
`borrow_guard` when used. A wallet can prepare a finite chain and release links at will to authorize individual borrows.

The idea originates in Rivest and Shamir's [PayWord and MicroMint: Two Simple
Micropayment Schemes](https://people.csail.mit.edu/rivest/pubs/RS96a.pdf). KCC20
adapts the one-way hash-chain construction by binding each link to a distinct
one-time Schnorr key.

To prepare a chain for `n` borrows, the wallet chooses a random value `x_0` and
`n` one-time Schnorr keypairs `(private_key_i, pubkey_i)`, then computes:

```text
x_1 = Hash(x_0 || pubkey_1)
x_2 = Hash(x_1 || pubkey_2)
...
x_n = Hash(x_(n-1) || pubkey_n)
```

The initial `borrow_guard` is `x_n`, which commits to the complete sequence. A
borrow against guard `x_i` reveals `x_(i-1)` and `pubkey_i`, and includes a
transaction signature by the corresponding one-time private key. It proves the
authorization by requiring:

```text
Hash(x_(i-1) || pubkey_i) == x_i
VerifySchnorr(pubkey_i, transaction, signature_i)
```

The wallet gives the intended sender `x_(i-1)` and `private_key_i`. The revealed
value `x_(i-1)` becomes the successor's `borrow_guard`, ready for the next borrow.

The authorizations are revealed in reverse order and cannot be reused. The
wallet may release them one at a time while monitoring each borrow, or several
in advance while accepting that its outpoint may change until they are consumed
or revoked. The chain is exhausted after `x_0` is revealed.

#### Wallet-control model

The hash-chain scheme is designed to keep the recipient's wallet in control of
when its UTXO may change. The wallet releases one authorization while monitoring
the network, records the confirmed successor outpoint, and keeps the next
authorization private until another change is expected. Without a released
authorization, the UTXO cannot be borrowed, so the wallet may go offline knowing
that its outpoint will remain stable.

Before going offline, a wallet that has released an authorization which remains
unused may revoke it through an owner-authorized transfer or consume it itself
in a valid borrowed receive.
