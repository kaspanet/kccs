```
KCC: ?
Title: Pay-to-Public-Key-Hash via P2SH
Description: P2PKH scheme for keeping the public key hidden until spending.
Authors: Ori Newman <orinewman1@gmail.com>, Gaurav Rana <BitcoinsSSG@gmail.com>
Comments-URI: https://kas-smiths.org/t/pay-to-public-key-hash-via-p2sh/163
Status: Draft
Type: Standards Track
Category: Application
```

## Abstract

This KIP defines a Pay-to-Public-Key-Hash (P2PKH) wallet convention using Pay-to-Script-Hash (P2SH), keeping the public key hidden until spending.

## Motivation

Kaspa supports Pay-to-Public-Key (P2PK) and P2SH addresses, but has no native P2PKH address type. P2PK addresses expose the public key immediately, allowing a sufficiently capable quantum computer to recover the private key using Shor's algorithm. This convention avoids that exposure until spending, provided the key has not been disclosed elsewhere.

Keeping public keys hidden also enables a cleaner future transition to post-quantum signatures. [BIP361](https://github.com/bitcoin/bips/blob/master/bip-0361.mediawiki) proposes a post-quantum migration for Bitcoin and discusses rescue protocols for legacy funds. A corresponding migration mechanism could be specified separately for Kaspa.

Ordinary spends still reveal the public key and remain vulnerable to quantum attacks during confirmation. Wallets should avoid address reuse and public-key disclosure, including through extended public keys.

## Specification

### Redeem script

P2PKH is implemented using P2SH with the following redeem script:

```text
<P> OP_CHECKSIG
```

where `P` is a 32-byte x-only secp256k1 public key.

### Derivation path

Public keys MUST be derived using the [BIP32](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki) account structure defined in [BIP44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki), with purpose `XXXX'` (TODO: Change once KCC number is determined) and coin type `111111'`:

```text
m / XXXX' / 111111' / account' / change / address_index
```

The remaining levels are used as defined in [BIP44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki). The coin type is `111111'` on all networks.


## Rationale

P2SH is used because it allows public keys to remain hidden until spending under existing consensus rules. This lets wallets offer users an initial protective measure against quantum attackers without waiting for a consensus change. Introducing new signature schemes would require consensus changes; this convention provides a first step by reducing public-key exposure using functionality already available.

## Backwards Compatibility

Existing wallets can send to these addresses. Wallets must implement this convention to derive and discover the accounts.

## Conformance Vectors

TODO
<!--
  Mandatory for Standards Track KCCs that define byte layouts, encodings,
  hashes, or other computable artifacts; remove otherwise.

  Cover every construction this KCC defines. Mirror the same vectors as
  machine-readable JSON under kcc-NNNN/vectors/. The two must agree, and the
  machine-readable form is authoritative for automated testing (KCC-0,
  Section 5).
-->

## Reference Implementation

TODO
<!--
  OPTIONAL before Final: remove this section if not yet applicable.

  Contain or link to a reference implementation. A Standards Track KCC cannot
  reach Final without a public implementation passing the conformance vectors
  (KCC-0, Section 4.2).
-->

## Security Considerations

Protection relies on P2SH hash preimage resistance and the public key remaining undisclosed. Spending reveals the public key, leaving funds vulnerable to sufficiently fast quantum attackers before confirmation. Wallets should avoid address reuse and disclosure of public keys or extended public keys.

## Copyright

Copyright and related rights waived via [CC0](LICENSE.md).
