# KCC-0014: Soulbound Token Standard

| Field | Value |
|-------|-------|
| **KCC** | 0014 |
| **Category** | Asset Standard |
| **Title** | Soulbound Token — Non-Transferable Identity and Credentials |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |

## Abstract

A token that cannot be transferred. Permanently bound to its holder. Issued once, held forever — only revocable by the issuer or burnable by the holder. Represents identity, credentials, memberships, and attestations.

## Specification

| # | Entrypoint | Caller | Description |
|---|-----------|--------|-------------|
| 1 | `issue` | Issuer | Issue soulbound token to recipient |
| 2 | `revoke` | Issuer | Revoke token |
| 3 | `burn` | Holder | Voluntarily relinquish |
| 4 | `update` | Issuer | Update metadata (renewal, upgrade) |
| 5 | `verify` | Any | Check valid + unexpired |

## State

```
issuer       pubkey
holder       pubkey     // immutable after issue
token_type   enum       // KYC, CREDENTIAL, MEMBERSHIP, LICENSE
metadata     bytes32    // credential details
issued_at    uint64
expires_at   uint64     // 0 = permanent
status       enum       // ACTIVE, REVOKED, EXPIRED, BURNED
```

## Use Cases

| Type | Example | Consumed By |
|------|---------|-------------|
| KYC | AML check passed | RWA Token, Governed Token |
| Credential | Licensed attorney | Commerce contracts |
| Membership | DAO member | Governance |
| Accreditation | Accredited investor | SAFT, RWA Token |

## Encoding

For the technical encoding of transfer operations, state field ordering, witness semantics, and positional input/output pairing, see KCC-0020 (Fungible Token Covenant Specification by Manyfest, Michael Sutton, and IzioDev). This standard defines the interface; KCC-0020 defines the byte-level implementation.

## Rules

1. `holder` is immutable after `issue`. No transfer entrypoint exists.
2. Only the issuer may `revoke` or `update`.
3. `verify` returns `{valid, token_type, issuer, expires_at}`.
4. Expired tokens fail `verify`.