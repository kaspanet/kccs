```
KCC: ?
Title: Mobile Wallet Session and Pairing API
Description: Defines how a web application on a mobile device reaches a native wallet application over an encrypted session.
Authors: (@danieliyahu1)
Status: Draft
Type: Standards Track
Category: Interface
Created: 2026-10-03
Requires: KCC-12, KIP-5
```

## Table of Contents

- [Abstract](#abstract)
- [Motivation](#motivation)
- [Specification](#specification)
  - [1. Scope and Reuse](#1-scope-and-reuse)
  - [2. Definitions](#2-definitions)
  - [3. Wallet Registry](#3-wallet-registry)
  - [4. Dapp Identity](#4-dapp-identity)
  - [5. Pairing](#5-pairing)
  - [6. Session Envelope](#6-session-envelope)
  - [7. Session Lifecycle](#7-session-lifecycle)
  - [8. Provider Discovery](#8-provider-discovery)
  - [9. Mapping to KCC-12](#9-mapping-to-kcc-12)
  - [10. Registry Additions to KCC-12](#10-registry-additions-to-kcc-12)
  - [11. Transport Binding: `walletconnect`](#11-transport-binding-walletconnect)
- [Rationale](#rationale)
- [Open Questions](#open-questions)
- [Backwards Compatibility](#backwards-compatibility)
- [Conformance Vectors](#conformance-vectors)
- [Reference Implementation](#reference-implementation)
- [Security Considerations](#security-considerations)
- [Copyright](#copyright)

## Abstract

This document specifies how a web application running in a browser on a mobile
device reaches a native wallet application installed on the same device. It
defines a wallet registry, a dapp identity that a wallet can verify, a pairing
payload and its handoff, an encrypted session envelope, and the session
lifecycle that connects them.

The native application is a wallet conforming to [KCC-12](kcc-0012.md). This
document does not redefine any part of that document. It adds the transport,
the identity model, and the session that a KCC-12 provider needs when it does
not live in the page that consumes it. A web application written against
KCC-12 needs no change to use a native wallet through this document.

## Motivation

KCC-12 defines how a page and a wallet in the same browsing context find each
other: the wallet dispatches events on `window`, and both sides share a
`Origin` that scopes permission. Both assumptions fail when the wallet is a
separate application on the same device.

There is no shared browsing context. A page cannot dispatch or receive
`window` events from a native application, and a native application cannot
inject a provider into a page. The page also cannot enumerate the
applications installed on the device, so it cannot discover a wallet the way
KCC-12 discovery does. And there is no `Origin` to scope permission to: the
requester crosses an application boundary, and the browser is the party that
normally attests to a page's origin, which is exactly what is missing here.

KCC-12 is therefore not an incomplete description of this case, it is a
description of a different case. The wallet problem it solves is the same
problem: a dapp must ask a separate security domain for accounts and
signatures, must not be able to lie about the answer, and must work across
wallets rather than per wallet. Only the transport and the identity model
differ. This document supplies those, and reuses everything else from KCC-12,
so that one dapp implementation covers a browser extension and a native
application without an adapter per wallet.

## Specification

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in RFC 2119 and RFC 8174.

Where TypeScript and prose state the same rule, the prose is authoritative.
Types, methods, encodings, and error codes named here and not defined here are
those of [KCC-12](kcc-0012.md), and are cited by section rather than
restated.

### 1. Scope and Reuse

This document is a binding. It defines how a browsing context reaches a
wallet that is not in it. It is not a new wallet interface.

The following are in scope:

- locating a native wallet that implements this document (Section 3);
- identifying the dapp to the wallet (Section 4);
- establishing an authenticated, encrypted session (Sections 5 and 6);
- the lifetime of that session (Section 7);
- presenting a KCC-12 provider to the page once a session exists
  (Section 8).

The following are out of scope and MUST NOT be defined here:

- method names, parameter shapes, and result shapes, which are KCC-12's;
- the transaction, bundle, address, amount, and network identifier encodings,
  which are KCC-12's;
- the error codes of KCC-12 Section 8, except for the assignments in
  Section 10 of this document;
- the permission and caveat model, which is KCC-12 Section 6.12, with the
  requester identity resolved as in Section 4 of this document;
- the confirmation display requirements, which are KCC-12 Section 5.3;
- the browser discovery protocol of KCC-12 Section 3, except as sharpened in
  Section 8 of this document.

An implementation of this document that also changes any of the above is not
conforming to KCC-12.

### 2. Definitions

Terms are given in the order of the connection they describe: a dapp
prepares a pairing, a wallet accepts it, a session is established, and the
page then holds a provider.

- **Dapp**: A web application that consumes a provider, as in KCC-12
  Section 1, running in a mobile browser on the device.
- **Wallet**: A native application on the same device that conforms to
  KCC-12 and to this document, and that holds the user's keys.
- **Requester identity**: The verified identity of the dapp, defined in
  Section 4, that replaces the browser `Origin` in the permission model.
- **Registry**: The list of wallets that implement this document, defined in
  Section 3.
- **Registry entry**: One wallet's row in the registry.
- **Pairing payload**: The closed data structure of Section 5.1 that a dapp
  produces and delivers to a wallet.
- **Pairing reference**: The wire form of a pairing payload, defined in
  Section 5.2.
- **Handoff**: The navigation from the page to the wallet that carries the
  pairing reference, defined in Section 5.3.
- **Session**: The authenticated channel between one page and one wallet
  established by an accepted pairing, defined in Sections 5.4 and 6.
- **Session key**: The two directional keys derived in Section 6.1.
- **Frame**: The transmitted unit defined in Section 6.2.
- **Session message**: The plaintext unit defined in Section 6.3.
- **Requester**: The party that sends a `request` message, which is the dapp.
- **Responder**: The party that answers a `request` message, which is the
  wallet.
- **Message identifier**: The `Hex[64]` that correlates a `result` or `error`
  message with its `request`.
- **Transport binding**: The way frames reach the other party, selected by the
  `type` of the `transport` object of Section 5.1.
- **Relay**: An endpoint that forwards frames between peers without being able
  to read them.

`Hex`, `Hex[64]`, `Uint64`, `Address`, `NetworkId`, `ProviderRpcError`,
`KaspaProviderInfo`, and `KaspaProviderDetail` have the meanings of KCC-12
Sections 7.1, 7.2, 7.3, 2, 4.3, 3.2, and 3.3 respectively.

### 3. Wallet Registry

A page cannot enumerate the applications installed on a device, so the list of
wallets must come from a document.

A **registry** is an enumerated value space defined by this document. Its
values are the entries of the registry document defined below. This document
assigns no entries; a registry document is published separately and
referenced by the dapp. A dapp MUST NOT offer a wallet that is absent from
the registry it uses, and MUST NOT fabricate an entry.

A **registry entry** is a JSON object with exactly these members:

```text
RegistryEntry object
  rdns     string    required  stable identifier, reverse domain name
  name     string    required  display label, carries no authenticity
  icon     string    required  https URL, or data: URI per KCC-12 Section 3.6
  appLink  string    required  absolute https base URL, no query, no fragment
  relays   array     required  relay base URLs, ordered by preference, at least one
  networks array     optional  NetworkId values the wallet supports
```

- `rdns` MUST be a valid reverse domain name identifier as KCC-12
  Section 3.2 requires. It is the stable identity of the wallet, and apps MAY
  group by it.
- `appLink` MUST be an `https` URL with no query and no fragment. A registry
  entry with any other scheme is invalid.
- `networks`, when present, is informational. A dapp MUST NOT treat it as
  evidence that a network is reachable.

A dapp MUST render an entry's `icon` only through an `<img>` element or an
equivalent mechanism that does not execute script, as KCC-12 Section 3.6
requires, and MUST reject an `icon` that is not an `https` URL or a `data:`
URI.

The registry is a trust anchor. A dapp MUST load it over `https`, MUST NOT
load it from a channel the user did not choose, and a dapp MUST show the
`appLink` host to the user when it offers a wallet. See
[Security Considerations](#security-considerations).

Custom URI schemes are deliberately excluded. A scheme is not bound to a
domain, any application may claim it, and on some platforms the most recently
installed holder of a scheme is chosen with no user choice. A pairing
reference MUST therefore be delivered by `https` navigation to `appLink`, so
that the operating system resolves the wallet by verified domain association.

### 4. Dapp Identity

A wallet has no `Origin` to trust. This section defines the substitute, and
only the substitute: everything downstream of it, including the permission
model, the confirmation display, and the `invoker` member of a
`Permission`, is KCC-12's.

A **dapp identity** is a JSON object with exactly these members:

```text
DappIdentity object
  url   string    required  the dapp's origin: scheme, host, and optional port
  name  string    required  display label, carries no authenticity
  icon  string    optional  https URL, or data: URI
```

A **dapp document** is a JSON object served at the path
`/.well-known/kaspa-dapp` under the `https` scheme at the host named by the
dapp identity's `url`, with exactly these members:

```text
DappDocument object
  v     integer  required  document version: 1
  host  string   required  the host that served this document, lowercase
  rdns  string   required  reverse domain name of the organisation
  name  string   required  display label, carries no authenticity
  icon  string   optional  https URL, or data: URI
```

To **verify** a dapp identity, a wallet MUST:

1. reject a `url` whose scheme is not `https` or `http`, or whose host is
   empty;
2. fetch the dapp document over `https` from the `url`'s host at the path
   above, with no redirect to another host;
3. reject the document if `v` is not `1`, or if `host` is not exactly the
   requested host, compared as lowercase ASCII;
4. record the identity as **verified** on success, and as **unverified** on
   any failure, with no distinction among the reasons for failure.

`rdns` in the document is an organisational label. It MUST NOT be derived
from the host, and a wallet MUST NOT present it as evidence of anything.

A wallet MUST display the verified or unverified state, and the `url` host
including its scheme, on every confirmation, as part of the confirmation that
KCC-12 Section 5.3 already requires. A wallet MUST NOT display a dapp's `name`
in place of its host.

The dapp identity is the requester identity for the purposes of
[KCC-12](kcc-0012.md) Section 5.1. The `invoker` member of a `Permission`
MUST be the dapp identity's `url`. One wallet MUST NOT let one dapp identity
observe or reuse another dapp identity's authorization.

Verification establishes that a domain publishes the identity it claims. It
does not establish that the page which initiated the pairing is on that
domain. See
[Security Considerations](#security-considerations).

### 5. Pairing

#### 5.1 Pairing payload

A dapp MUST create a fresh pairing payload for every pairing attempt. The
payload is a JSON object with exactly these members:

```text
PairingPayload object
  v           integer     required  payload version: 1
  id          Hex[64]     required  pairing identifier, fresh per attempt
  secret      Hex[64]     required  32-byte ephemeral secret
  transport   object      required  TransportBinding
  dapp        object      required  DappIdentity
  permissions array       required  requested permissions, at least one
  expiresAt   Uint64      required  Unix time in milliseconds
```

A **TransportBinding** is a JSON object with exactly these members:

```text
TransportBinding object
  type    string   required  transport binding identifier
  topic   Hex[64]  required  rendezvous topic
  relays  array    required  relay base URLs, at least one
```

`type` is a registry of transport binding identifiers. This document assigns
one value, `walletconnect`. A consumer MUST reject a payload whose `type` it
does not implement, and MUST NOT attempt a partial interpretation. The
`walletconnect` binding is specified in Section 11.

`permissions` holds permission requests in the form of KCC-12 Section 6.12,
each naming a `parentCapability` and its `caveats`. A dapp MUST NOT request a
permission it does not need, and a wallet MUST NOT settle a payload naming a
permission it does not implement, or whose `parentCapability` it does not
implement. A wallet that refuses on either ground MUST publish nothing, so
that the dapp observes the absence of a session and not an error.

`expiresAt` MUST be at most 10 minutes after the moment the dapp created the
payload. A wallet MUST reject a payload whose `expiresAt` has passed, and MUST
reject a payload older than that bound when the wallet's own clock says so.
The secret and the payload MUST NOT be written to logs, analytics, crash
reports, or error text by either party.

#### 5.2 Pairing reference

The **pairing reference** is the wire form of a pairing payload:

```text
pairing-reference = base64url( utf8( PairingPayload ) )
```

`base64url` is the unpadded base64 encoding of RFC 4648 Section 5, using the
alphabet `A-Z a-z 0-9 - _`, with no `=` padding and no line breaks. It is the
unreserved form, so a pairing reference needs no further percent-encoding in a
query string.

A producer MUST emit members of a pairing payload in the order given by the
object layouts above, with no insignificant whitespace, and MUST NOT emit
members the layouts do not list. A consumer MUST reject a payload that is not
a JSON object, that lacks a required member, that carries an additional
member, or whose member has a type or form other than the one listed, and
MUST ignore the order in which it received members.

A consumer MUST treat `id` and `secret` as sensitive. `id` is not a secret;
`secret` is.

#### 5.3 Handoff

To **hand off**, a dapp MUST navigate the browsing context to the wallet's
`appLink` with the pairing reference as the single query parameter `r`:

```text
handoff-url = appLink "?r=" pairing-reference
```

The dapp MUST navigate only in direct response to a user action, MUST NOT
navigate on page load, and MUST NOT navigate more than once per pairing
attempt. It MUST NOT place the pairing reference in a fragment, in a path
segment, or in a `Referer` header, and it MUST remove it from its own address
bar as soon as the handoff begins, so that it does not survive in history or
in a shared link.

A wallet MUST accept a handoff only at its `appLink` with the parameter `r`,
and MUST reject any other entry point, any additional query parameter, and
any handoff whose `appLink` is not served over `https` at a host the wallet
claims. A wallet MUST treat each pairing reference it accepts as spent after
one use, for the lifetime of the process, and MUST NOT accept it again.

A dapp MUST NOT conclude from a failed navigation that a wallet is absent.
Mobile browsers report a failed launch inconsistently, and a wallet may be
installed and locked. A dapp MUST offer the user the choice to retry, to pick
another registry entry, or to stop, and MUST NOT loop.

#### 5.4 Settlement

After the user accepts the pairing, the wallet MUST, in this order:

1. verify the dapp identity per Section 4 and hold the result;
2. derive the session keys per Section 6.1;
3. subscribe to the payload's `topic` on the first reachable `relays` entry;
4. publish one encrypted `event` message with `event` set to
   `kaspa_sessionEstablished`, carrying the session information of
   Section 5.5.

A dapp MUST derive the same keys from the same payload, subscribe to the same
`topic`, and wait for that message. On receiving it, the dapp has a session,
MUST create a provider per Section 8, and MUST dispatch the announcement of
Section 8.2. A dapp that does not receive the message within a timeout it
chooses MUST abandon the attempt, MUST NOT reuse the pairing reference, and
MUST NOT report a wallet error; the dapp did not reach the wallet.

A wallet MUST NOT publish anything before the user has accepted, MUST NOT
publish on a topic it has not verified belongs to this pairing, and MUST NOT
send any part of the pairing payload or the session keys over the relay in
clear.

### 6. Session Envelope

#### 6.1 Key derivation

Both parties derive the same keys from the pairing payload alone.

- Let `ikm` be the 32 bytes of `secret`, and `salt` the 32 bytes of `id`.
- The client-to-responder key is `HKDF-SHA256(ikm, salt, "kaspa-mobile-v1-c2s", 32)`.
- The responder-to-client key is `HKDF-SHA256(ikm, salt, "kaspa-mobile-v1-s2c", 32)`.

The two keys MUST differ. A party MUST encrypt every frame it sends with its
outgoing key and MUST reject any frame whose authentication tag does not
verify under the incoming key, which prevents a party reflecting a message
back to its sender.

`id` as the salt separates sessions that share a secret by accident, and the
two `info` strings separate directions. Neither is a password derivation: the
input is already 32 bytes of entropy.

#### 6.2 Frame

A **frame** is the transmitted unit:

```text
frame = "KM01" | nonce | ciphertext
```

- `"KM01"` is four ASCII bytes, the frame version tag.
- `nonce` is 24 bytes, generated fresh for every frame, and MUST NOT repeat
  under one session key.
- `ciphertext` is `plaintext length + 16` bytes, being the output of
  ChaCha20-Poly1305 (RFC 8439) with a 24-byte nonce over the UTF-8 encoding of
  the session message, with `"KM01"` as associated data. The 24-byte nonce is
  consumed as follows: its first 16 bytes are passed through HChaCha20 with
  the session key to produce a subkey, and its last 8 bytes are zero-padded to
  12 to form the nonce of the RFC 8439 AEAD under that subkey.

The plaintext never leaves the two parties. A relay MUST NOT be given the
session keys and MUST NOT be able to read or alter a plaintext.

A receiver MUST discard a frame whose tag is not `KM01`, whose length is
wrong, or whose authentication tag does not verify, and MUST NOT reply to it,
MUST NOT log its contents, and MUST NOT count it as an error to report to the
user. After 100 consecutive discarded frames a party SHOULD end the session.

#### 6.3 Session messages

A **session message** is a JSON object, UTF-8 encoded, whose `kind` member
selects its exact shape. A consumer MUST reject a message with no `kind`, with
a `kind` it does not implement, or with members the matching shape does not
list.

```text
common members, required in every shape
  v       integer  required  message version: 1
  session Hex[64]  required  session identifier, equal to the pairing payload's id
  id      Hex[64]  required  message identifier, fresh per message
  kind    string   required  shape selector
```

```text
kind = "request"
  method  string  required  KCC-12 method name
  params  array   required  KCC-12 params, positional, per that method

kind = "result"
  result  any     required  the method's result; null where the method returns null

kind = "error"
  error   object  required  ProviderRpcError per KCC-12 Section 4.3

kind = "event"
  event   string  required  event name, see below
  data    any     required  event payload
```

Params are positional arrays, as KCC-12 Section 4.1 requires. A `wallet_` or
`kaspa_` method name not defined by KCC-12 MUST be treated as a
not-implemented method, with the behavior of KCC-12 code `4200`.

Only the dapp sends a `request`. Only the wallet sends a `result`, an `error`,
or an `event`. A receiver MUST reject a message of the wrong direction.

A `result` or `error` message MUST carry the `id` of the `request` it
answers, and a receiver MUST reject a response whose `id` matches no request
it has sent and has not yet resolved. A receiver MUST ignore a message whose
`id` it has already processed, so that a relay that duplicates or reorders
frames cannot cause a second effect.

A responder MUST process `request` messages in the order it receives them, and
MUST NOT answer a request it has not received. A responder MAY answer out of
order, and responses are matched by `id` alone.

On the `event` member: a value beginning with `kaspa_` is a protocol event
defined by this document, and a consumer MUST ignore a `kaspa_` value it does
not implement. Any other value is a KCC-12 provider event name and has the
meaning KCC-12 Section 4.4 gives it, with `data` as that event's payload.
This document assigns two protocol events, `kaspa_sessionEstablished` and
`kaspa_pendingRequest`.

A request MUST NOT be answered by the relay, and a request MUST NOT be
replayed: a responder MUST reject a `request` whose `id` it has already
processed.

#### 6.4 Timeouts and pending requests

A `request` MAY remain unanswered while the user is in the wallet application.
A responder MUST NOT impose a timeout shorter than it can honour while its own
user interface is in the foreground, and MAY reject with KCC-12 code `-32002`
when it already holds a pending request of the same kind, as KCC-12
Section 5.6 allows.

A responder MUST, upon presenting a confirmation for a `request`, publish one
`event` message with `event` set to `kaspa_pendingRequest` and `data` set to
`{ id, method }`, where `id` is the request's identifier and `method` its
name. A dapp MAY use this to show that approval is in progress. A dapp MUST
NOT treat its arrival as a result, and MUST NOT retry the request on its
account.

No `request` may remain pending indefinitely. A responder that cannot obtain a
decision MUST answer with an `error` message, and a dapp that has been waiting
for a time it chose MUST stop waiting, MUST end the session if it cannot
resume, and MUST report the failure to its own user. A promise that can never
settle is a defect, not a state.

### 7. Session Lifecycle

#### 7.1 Session information

The `kaspa_sessionEstablished` event carries:

```text
SessionInfo object
  networkId  string   required  the session's current network identifier
  accounts   array    required  Address values, active account first
  expiresAt  Uint64   required  Unix time in milliseconds
```

`accounts` are the addresses authorized for the dapp identity, subject to the
`restrictReturnedAccounts` caveat of KCC-12 Section 6.12, and encoded for
`networkId`. The wallet MUST reject a session whose requested permissions it
could not grant in full; a wallet MUST NOT settle a session with fewer
permissions than the pairing payload requested without the user's explicit
agreement on the reduced set.

#### 7.2 Authorization

The pairing grant is a grant of the permissions the dapp requested. From the
moment of settlement the dapp holds exactly those, and the permission model of
KCC-12 Section 5 applies with the requester identity of Section 4 in place of
`Origin`.

- `kaspa_accounts` MUST resolve with the addresses of Section 7.1 and MUST NOT
  prompt, because the grant was made during the pairing.
- A restricted method whose permission was not granted MUST reject with
  KCC-12 code `4100` without user interaction.
- A dapp MUST NOT rely on a method KCC-12 does not mark Required, and MUST
  detect any other method by calling it and handling KCC-12 code `4200`, as
  KCC-12 Section 4.1 requires.

`wallet_revokePermissions` invoked on the provider MUST be sent to the wallet
as a `request`. The wallet MUST, on revoking `kaspa_accounts`, publish
`accountsChanged` with an empty array, then end the session. A dapp MUST
NOT reuse a session after it has issued a revocation.

#### 7.3 Locking, expiry, and revocation

While the wallet is locked, KCC-12 Section 5.5 applies unchanged: the
provider holds no accounts, the wallet MAY prompt to unlock, and a `request`
MUST NOT be answered from a locked wallet without the unlock.

A session is **expired** when the current time is at or past the `expiresAt`
of Section 7.1. On expiry a party MUST stop sending `request` messages, MUST
end the session, and MUST reject a `request` it receives with KCC-12 code
`4904`.

A session is **revoked** when the user, or the wallet, withdraws it. The
wallet MUST publish an `event` message with `event` set to `disconnect` before
closing the channel, and a dapp that receives it MUST emit the KCC-12
`disconnect` event and MUST NOT reconnect. A wallet that cannot deliver that
message because the transport is already gone still ends the session.

When the transport fails for any other reason, a dapp MUST emit `disconnect`
with the `ProviderRpcError` that KCC-12 Section 4.4 requires, using close
code `1013` as that section recommends. A dapp MUST NOT reconnect on its own,
MUST NOT re-pair without a user action, and MUST NOT reuse a pairing
reference.

#### 7.4 Persistence

By default a dapp holds the pairing payload, and therefore the session key, in
memory for the lifetime of the page, and a page reload ends the session.

A dapp MAY persist the pairing payload in storage scoped to its own origin,
under all of the following conditions:

- the dapp MUST clear it when the session ends for any reason, and MUST clear
  it on any `accountsChanged` event carrying an empty array;
- the dapp MUST NOT expose it to any other origin, and MUST NOT place it in a
  URL, a fragment, or a request to any party other than the relays;
- the dapp MUST re-verify the dapp document per Section 4 before reusing a
  persisted payload, and MUST discard it if verification no longer succeeds;
- a dapp that persists a pairing payload MUST treat every script running on
  its origin as able to read it, and MUST NOT present a persisted session as
  protected from the page.

A persisted session still expires. Reuse after `expiresAt` MUST fail with
KCC-12 code `4904`, and the dapp MUST pair again.

Reconnecting a session across a browser restart is not specified by this
document. A dapp MUST NOT claim to do it.

### 8. Provider Discovery

#### 8.1 The difference from KCC-12

KCC-12 Section 3.4 has a wallet announce its provider on page load and again on
every `kaspa:requestProvider`, because a browser extension is present in the
page before any interaction. A native wallet is not in the page, and no
provider can exist before there is a channel to carry it.

This document therefore sharpens KCC-12 Section 3.4 for the case it does not
describe: a conforming implementation of this document MUST NOT announce a
provider before a session exists, MUST announce when a session is established
per Section 5.4, and, while a session exists, MUST answer every
`kaspa:requestProvider` and MUST NOT remove its listener. A dapp MUST treat
the absence of an announcement as "no native wallet is connected", and MUST
NOT treat it as an error or as evidence that no wallet is installed.

Nothing else in KCC-12 Section 3 changes. There is no shared global: a dapp
MUST NOT require one, and a wallet MUST NOT rely on one.

#### 8.2 The announcement

When a session is established, the dapp MUST create a provider object that
satisfies KCC-12 Section 4 in full, and MUST dispatch a
`kaspa:announceProvider` event on `window` whose `detail` is a
`KaspaProviderDetail`:

- `detail.info` MUST satisfy KCC-12 Section 3.2, with a fresh version 4 UUID
  generated at this moment, and `rdns`, `name`, and `icon` taken from the
  registry entry that was paired;
- `detail.provider` MUST be the provider object;
- the dapp SHOULD freeze `detail` and `detail.info` per KCC-12 Section 3.4,
  and MUST NOT alter an announcement already dispatched.

The dapp MUST dispatch exactly one `kaspa:announceProvider` per session, and
MUST NOT dispatch a second one for the same session. A second session, a
second pairing, produces a new UUID and a new provider, and the dapp MUST
treat the earlier provider as ended.

An app MAY group or deduplicate announcements per KCC-12 Section 3.5. Note
that the spoofing concern KCC-12 Section 3.5 raises does not apply in the same
way: a `KaspaProviderInfo` in this binding is backed by a session whose
possession of the session key is proven, so an announcement made by page
script alone carries no session and MUST NOT be used.

#### 8.3 Events

Once a session exists, the wallet emits KCC-12 events and the dapp's provider
emits them to the page:

| KCC-12 event     | Emitted by this binding when                                        |
| ---------------- | ------------------------------------------------------------------ |
| `connect`        | the provider is created, with the `networkId` of Section 7.1        |
| `disconnect`     | the session ends, per Section 7.3                                   |
| `networkChanged` | the wallet changes the session's network, per KCC-12 Section 6.11   |
| `accountsChanged`| the value `kaspa_accounts` would return changes, per KCC-12         |
| `message`        | the wallet emits a `message` event, per KCC-12 Section 4.4          |

A dapp MUST emit `networkChanged` before `accountsChanged` when both follow a
network change, as KCC-12 Section 6.11 requires.

### 9. Mapping to KCC-12

A provider of this binding is a KCC-12 provider. The mapping is:

- `request` sends a `request` message and resolves with the `result` of the
  `result` message, or rejects with the `error` of the `error` message. The
  Promise MUST NOT resolve with a frame, a message, or any other transport
  envelope, as KCC-12 Section 4.1 requires.
- `on` and `removeListener` have the semantics of KCC-12 Section 4.4, and the
  provider MUST support removal, which a dapp needs when a session ends.
- Every method, parameter, result, encoding, and display requirement is
  KCC-12's, cited by section. This document adds none.
- Params are positional, as in KCC-12 Section 4.1, on every binding. A dapp
  written against KCC-12 therefore uses the same call for a browser extension
  and for a native wallet.
- The `invoker` of every `Permission` is the dapp identity's `url`, as
  Section 4 requires. The rest of KCC-12 Section 6.12 is unchanged.

The wallet, not the dapp, implements KCC-12. The wallet MUST satisfy every
requirement KCC-12 places on a wallet, including the confirmation display of
Section 5.3, the watch-only and locked-wallet rules of Sections 5.4 and 5.5,
and the security rules of its Security Considerations. This document does not
relax any of them, and a native wallet has one requirement KCC-12 does not
have: the confirmation interface is in a different application from the dapp,
so the wallet MUST NOT rely on the page for any part of it, including the
display of the requester identity of Section 4.

Two binding-specific consequences of that separation:

- A wallet MUST NOT accept a requester identity, a permission, or a parameter
  from the page except inside an authenticated `request` message. A dapp
  sends no other kind of message.
- A dapp MUST NOT assume the wallet can see anything about the page, and a
  wallet MUST NOT assume the page can see anything about the wallet beyond
  what it sends in messages.

### 10. Registry Additions to KCC-12

This document adds no RPC method to the KCC-12 Section 6 registry, adds no
caveat type to KCC-12 Section 6.12, and adds no `message` type to KCC-12
Section 4.4. It adds four codes to the KCC-12 Section 8 registry, from the
range that section reserves for this and future KCCs.

| Code   | Message               | Meaning                                                        |
| ------ | --------------------- | -------------------------------------------------------------- |
| `4903` | No Session            | A request was issued before a session was established, or after one ended. |
| `4904` | Session Expired       | The session is past its `expiresAt`.                            |
| `4905` | Session Revoked       | The user or the wallet withdrew the session.                   |
| `4906` | Transport Unavailable | No relay was reachable, or the channel failed.                  |

A dapp MUST reject a `request` with `4903` before settlement, or after a
session has ended, without user interaction. A wallet MUST NOT use `4903`;
the absence of a session is a dapp-side condition.

These are session-layer codes and are distinct from `4900`, which KCC-12
defines as the provider's disconnection from all networks. A session can be
healthy while the wallet cannot reach any node, and a session can be gone
while the wallet is online.

`4901` remains reserved by KCC-12 for a future network-scoped method and is
not assigned here.

### 11. Transport Binding: `walletconnect`

The `walletconnect` binding identifies a transport that carries frames through
a relay, with the payload's `topic` as the rendezvous point, and with peer
metadata and discovery served by the relay under its own rules.

A binding that claims `type` `walletconnect` MUST carry the frames of
Section 6.2 unchanged as its wire payload. A peer MUST NOT be given a
plaintext frame, and MUST NOT be able to substitute its own key material for
the session keys of Section 6.1.

The binding is described here because a payload naming it must be
interoperable, not because this document defines it. Implementations SHOULD
use an existing implementation of this transport. A binding MUST reject a
frame whose payload does not parse as a frame of Section 6.2, even when the
transport's own authentication succeeded.

A second transport binding, if one is needed, is assigned by a later KCC that
adds a value to the Section 5.1 registry. An implementation MUST NOT treat an
unassigned value as a binding it may interpret.

## Rationale

**Why extend KCC-12 rather than define a mobile interface.** A dapp needs the
same things from a mobile wallet as from an extension: accounts, a network, a
signed message, a signed transaction, a submitted bundle, the same
encodings, the same error codes, the same confirmation rules. Only the way the
message travels and the way the requester is identified differ. Defining a
second method and error registry would give the ecosystem two spellings for
the same call, which is the outcome KCC-12 was written to end.

**Why the wallet stays a KCC-12 wallet.** It makes the binding additive. The
wallet implements KCC-12 and adds this document, rather than implementing a
parallel wallet interface and hoping dapps support both. A dapp written
against KCC-12 works with a native wallet without a line changed, which is
the property that keeps the dapp side from fragmenting.

**Why two payload formats.** The pairing payload changes for one reason, the
way the pairing is delivered, and the session envelope changes for another,
the way frames travel. A single combined message format would couple them, and
a change to one would force review of the other. They are also transmitted at
different times by different parties, which is a second reason to keep them
apart.

**Why a transport registry with one value.** Frames are defined without
reference to how they travel, which is what lets the same session work over
more than one transport. Nothing further is specified, because a second
transport does not exist and an abstraction over transports that do not exist
is cost without benefit. A second value is assigned when a second transport
needs one.

**Why no key exchange for the dapp.** A key published in the dapp document and
proven at pairing would not help. The party that initiates the pairing is the
page, and a page can claim any `url` whose host publishes a matching
document. Only a browser can attest to a page's origin, and there is no
browser in this path. A key exchange would add dapp ceremony and a registry of
dapp keys while leaving the actual threat unchanged, so the specification
states the limit instead: verification establishes that a domain publishes the
identity it claims, and the user judges the host shown on the confirmation.

**Why the secret is in the reference, and not negotiated.** The pairing
reference already travels over a channel the operating system binds to a
domain, and it is consumed once. A key agreement would add a round trip and a
failure mode to a step that happens once, in front of a user, with the
reference never persisted.

**Why in memory by default.** The session key protects the channel from the
transport operator, not the user from the page. Authority stays in the
wallet's confirmation interface, exactly as KCC-12 states, so holding the key
in the page does not grant anything. It is still a secret, and persisting it
by default would make every reload a silent reconnection to a session the user
may not remember authorizing. Persistence is therefore permitted, with
conditions, rather than forbidden, because some dapps cannot ask the user to
connect on every page load.

**Why no custom URI schemes.** A scheme is not bound to a domain, so nothing
prevents another application from claiming it, and on some platforms the most
recently installed holder wins with no user choice. An `https` handoff to a
domain the operating system associates with the wallet is verifiable, and the
`r` parameter is the only thing that needs protecting.

**Why same-device only in this document.** The pairing reference is a byte
string usable as a query parameter or as a QR code, so cross-device pairing
needs no change to the formats. The flows do: a second device has no
operating system association with the wallet, the user must scan instead of
navigate, and the exposure of a pairing secret to a camera is a different
threat. Specifying cross-device now would add a threat model for a case
nobody has asked for. The formats do not preclude it.

**Why no new methods.** The dapp initiates pairing outside the provider, and
everything after settlement is a KCC-12 call. A `connect` or `disconnect`
method would duplicate a decision the dapp already made before the provider
existed. Four error codes cover every new failure, and no new method is
needed for the binding to be complete.

**Alternatives considered.** WalletConnect v2 is used as the first transport
binding because it is deployed, and because a Kaspa namespace for it already
exists in shipping software. A Kaspa-operated relay was considered and
rejected as the first binding: it makes the document depend on an operator
that would then have to exist first. A localhost bridge was considered and
rejected: a browser on a phone cannot reach a local service in another
application, and no port can be reserved across applications.

## Open Questions

This section is informative. It records what this document does not yet
settle, so that reviewers can see the open work in one place and weigh in. It
MUST be removed or resolved before this document enters Last Call. None of the
items below changes a requirement stated in the Specification; where an item
names a current position, that position is what the Specification currently
says.

### Unwritten material

| Item                        | Required by                        | Status      |
| --------------------------- | ---------------------------------- | ----------- |
| KCC number                  | KCC-0 Section 7                    | unassigned  |
| `Comments-URI`              | KCC-0 Section 7, from Review       | not created |
| Conformance vectors         | KCC-0 Section 4.2, before Final    | not started |
| Reference implementation    | KCC-0 Section 4.2, before Final    | not started |
| Auxiliary types and examples| KCC-0 Section 9, optional          | not started |
| Author display name         | KCC-0 Section 7, optional          | handle only |

### Trust and identity

1. **Is `/.well-known/kaspa-dapp` the right mechanism, and what should it
   contain?** The document defines it as the whole of verification and
   deliberately carries no key. A future revision could carry a key so that
   the pairing itself is bound to the domain, but that does not fix the case
   the document names, a page claiming a domain it does not serve. Reviewers
   should say whether the document should stay as it is, or whether a key is
   worth adding for a narrower purpose.

2. **How long is a verification cached?** The Specification says a wallet
   verifies before settling and re-verifies a persisted payload, but says
   nothing about caching within a session or across sessions. A cache policy
   is needed, and it trades freshness against a request to the dapp's host on
   every pairing.

3. **Should `dapp.url` be required to use `https`?** The current rules accept
   `http` and still fetch the document over `https`, so an `http` page can
   present a verified host. Requiring `https` outright is simpler and stricter.
   Reviewers should say which.

### Registry

4. **Where does a registry live, who publishes it, and is it signed or
   versioned?** The Specification calls a published registry document a
   requirement and a trust anchor, and specifies an entry, but says nothing
   about distribution, signing, or versioning. This is the largest
   unaddressed item in the document.

5. **Should relays be chosen by the registry entry or by the wallet's own
   domain?** The entry carries `relays`, so the registry publisher also chooses
   the transport for every wallet in it. Moving relay discovery to a document
   served by the wallet's own domain would separate the two, at the cost of a
   fetch during pairing. This interacts directly with item 4.

### Session

6. **Who chooses a session's lifetime?** `expiresAt` is required in
   `SessionInfo` but the Specification never says who sets it, whether it is
   bounded, or whether it is renewable. The wallet currently owns the value by
   omission.

7. **Is a conditional `MAY` for persistence the right call?** Section 7.4
   permits persistence with conditions. Forbidding it in v1 would be simpler
   and safer; requiring a way to restore a session would be friendlier. The
   current text is the middle position and is the one most likely to change.

8. **Should `wallet_revokePermissions` end the session?** Section 7.2 has the
   wallet end the session when `kaspa_accounts` is revoked. KCC-12 leaves the
   provider alive after a revocation. Either position is coherent, and the
   choice affects how a dapp resumes a revoked connection.

9. **Should the session identifier equal the pairing identifier?** The current
   envelope sets `session` to the pairing `id`. That reuses one value for two
   lifetimes, which is simple but couples them. A separate session identifier
   would decouple them at the cost of one more field.

10. **Is reconnect after a page reload or a browser restart out of scope for
    v1?** Section 7.4 says so and forbids a dapp from claiming otherwise.
    Reviewers should confirm, because this is the decision users feel most.

### Envelope and transport

11. **Is `kaspa_pendingRequest` worth specifying?** It exists so a dapp can
    show that approval is in progress, which matters when the page is
    backgrounded. It is also a second protocol event, and no other event in
    this document exists only for display. Reviewers should say whether to
    keep it.

12. **Is the ordering rule on requests necessary?** Section 6.3 requires a
    responder to process `request` messages in order. The wallet confirms each
    request in its own interface anyway, so the rule may buy nothing beyond
    complexity in the transport.

13. **Should the `walletconnect` binding be a section of this document or a
    document of its own?** Section 11 defines only the frame mapping. If a
    Kaspa namespace for that transport is standardized elsewhere, this section
    should probably become a reference rather than a definition, to keep one
    source of truth.

14. **Is fixing the AEAD construction over-specification?** The document
    derives its own keys and frames so that a relay cannot read traffic and no
    external normative dependency is introduced, which KCC-0 Section 8.1
    encourages. A transport that already offers end-to-end encryption would
    make this redundant. Reviewers should say whether the guarantee should
    live in the binding instead.

### Scope and process

15. **Is same-device really a requirement, or only an assumption?** The
    Specification describes one device and calls cross-device out of scope,
    but nothing it says enforces that the two applications are on the same
    device. The wording needs to be either made explicit as a non-requirement
    or left as the description of the intended path.

16. **Should the dapp side be normative at all?** This document defines a
    protocol and treats the JavaScript that a dapp uses as a reference
    implementation. That keeps wallets from shipping connectors per dapp, but
    it leaves the dapp-side ergonomics unspecified. Reviewers should say
    whether a minimal connector interface belongs here.

17. **Is `Requires: KIP-5` needed?** This document adds no KIP-5 cryptography
    and inherits it through KCC-12. It is listed for symmetry with KCC-12.

18. **Are the four new error codes complete?** In particular, a user rejecting
    a pairing is currently indistinguishable from a timeout, and there is no
    distinct code for a wallet that was opened but never became reachable.
    Reviewers should say whether either warrants its own code.

## Backwards Compatibility

This document introduces a new binding and does not change KCC-12. No previous
standard defines this path.

Wallets that today expose a proprietary namespace to mobile web applications
are unaffected by this document. A wallet MAY map its existing names onto
KCC-12's after this document and KCC-12 are Final; a dapp that must support
both during a transition may keep its existing adapter alongside a provider
from this binding. This document does not assign names to any existing
namespace, and does not require a deployed wallet to change any name it has
already published.

## Conformance Vectors

Machine-readable vectors belong under `kcc-XXXX/vectors/` and are authoritative
for automated testing. They are not yet written; this document cannot reach
Last Call until they are, per [KCC-0](kcc-0000.md) Section 5.

When written, they MUST cover every construction this document defines:

- pairing payload encoding and rejection: valid for each `transport.type`,
  wrong `v`, missing member, additional member, wrong member type, `expiresAt`
  beyond the bound, and a pairing reference whose decoded text is not a
  payload;
- handoff URL construction from a registry entry, and rejection of an entry
  whose `appLink` is not `https`;
- dapp document validation: `v` not `1`, `host` mismatched, redirect to
  another host, document absent;
- key derivation: the exact `c2s` and `s2c` keys for at least two known
  `(id, secret)` pairs, and that the two differ;
- frame construction and authentication: a valid frame, a frame with a
  corrupted tag, a frame with a truncated nonce, and a frame reflected under
  the wrong directional key;
- session messages: one valid instance of each of the four kinds, and
  rejection of an unknown `kind`, a `result` with no `result` member, a
  response with an unknown `id`, a `request` with named-object `params`, and a
  `request` naming a method not defined by KCC-12;
- session information and the four codes of Section 10.

Encodings reused from KCC-12 are covered by the vectors of that document and
are not duplicated here.

## Reference Implementation

None yet. Per [KCC-0](kcc-0000.md) Section 4.2, a public implementation
passing the vectors above is required before this document can reach Final.

Auxiliary material belongs under `kcc-XXXX/`, non-normative unless stated
otherwise: a TypeScript definition of the types of Sections 3 to 6, a
reference pairing payload, and worked examples of a handoff and a signed
`request`.

## Security Considerations

**The trust boundary is the wallet's user interface.** The page cannot be
trusted with anything, and this document gives it no authority it did not
already have. Every signature, every submission, and every grant of permission
is decided in the wallet's own interface, in a different application from the
requester. A wallet MUST NOT accept a requester identity, a permission, or a
parameter from the page except inside an authenticated message.

**A page can claim any origin, and this document cannot fix it.** The browser
is the party that attests to a page's origin. Verification here proves that a
domain publishes the identity it claims; it does not prove that the page which
initiated the pairing is on that domain, because that page chose the `url`.
A phishing page can therefore present a real domain's name and content. The
mitigation is what KCC-12 already relies on: the user reads the host on the
confirmation. A wallet MUST show the host, MUST show whether it is verified,
and MUST NOT show the dapp's `name` in its place. A dapp MUST NOT attempt to
assert its own legitimacy to the wallet, because nothing it says can be
checked.

**The pairing secret is carried in a URL.** It is readable by anything that
logs URLs, by the browsing context's own history, and by any code that reads
the address bar. Both parties MUST keep it out of logs, analytics, crash
reports, and error text, MUST treat it as spent after one use, and the dapp
MUST clear the address bar as Section 5.3 requires. A secret that has leaked
must not be usable: single use, the ten-minute bound on `expiresAt`, and the
binding of the session to the pairing identifier together limit what a
captured reference buys.

**The relay is an observer.** It sees topics, sizes, and timing, and nothing
else. It cannot read a frame, and cannot alter one without failing
authentication. It can see that a given wallet topic is active, which is
metadata, and a dapp that needs to hide that must assume it cannot.

**Replay and reflection.** A pairing reference is single use and time bound.
A session key is derived per session and per direction, so a captured frame
cannot be replayed into another session and cannot be reflected at its sender.
Message identifiers make duplicated frames harmless. A responder MUST NOT
answer a request identifier it has already processed.

**The registry is a trust anchor.** A registry entry decides which
application the user is asked to open, and a compromised or sloppy registry can
point `appLink` at a convincing imitation. The user's protection is the host,
which is why a dapp MUST show it. `rdns` and `name` carry no authenticity and
MUST NOT be presented as if they did.

**Session persistence widens exposure.** A persisted pairing payload can be
read by any script on the dapp's origin, including one injected later. That
is why persistence is optional, must be cleared when the session ends, and
must not be presented as protection from the page. It does not grant
authority, because authority is the user's consent in the wallet.

**Denial of service.** A page can pair repeatedly and can issue requests in a
loop. A wallet SHOULD rate limit a dapp identity, MAY reject with KCC-12 code
`-32002` when a request of the same kind is already pending, and MAY use
`-32005` to refuse. A wallet MUST NOT let a page drive its user interface
faster than the user can answer.

**Blind signing.** The display requirements of KCC-12 Section 5.3 and its
Security Considerations apply unchanged: every output, amount, script, and fee
before a signing confirmation, and the complete message before a signature.
Splitting the two applications makes this harder, not easier, since the dapp
cannot see the wallet's screen either. The wallet MUST NOT rely on the dapp
to display anything on its behalf, and MUST NOT accept a dapp's summary of a
transaction as a substitute for its own decoding.

**Versioning and downgrade.** A frame whose tag is not `KM01` and a message
whose `v` is not `1` are discarded, not guessed at. A payload whose
`transport.type` is unassigned is rejected rather than partially interpreted.

## Copyright

Copyright and related rights waived via [CC0](LICENSE.md).
