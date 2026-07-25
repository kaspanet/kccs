# Kaspa Calls for Conventions (KCCs)

Kaspa Calls for Conventions (KCCs) describe shared conventions for the Kaspa ecosystem, including covenant conventions, application interfaces, asset standards, wallet and indexer interoperability, based applications, verifiable programs, and other areas where independent implementations benefit from convergence.

Each KCC is a **Kaspa Call for a Convention**: a document specifying a convention around which independent ecosystem participants and implementations may converge. Acceptance marks an ecosystem convergence point; it does not make the convention protocol ground truth.

KCCs do not propose changes to Kaspa consensus or core-node behavior. Such changes belong in [Kaspa Improvement Proposals (KIPs)](https://github.com/kaspanet/kips).

---

## Overview

This PR proposes 16 KCCs across three layers, building on the KCC-0020 transfer convention (Manyfest, IzioDev). Together they define a complete covenant token and commerce infrastructure for the Kaspa ecosystem.

### Layer 1: Token Standards (KCC-0008 through 0015)

These standards define the asset primitives — how tokens are created, transferred, burned, governed, vested, and identified on Kaspa.

**KCC-0008 — Multi-Token Standard (Foundation)**
A single 147-byte state header supporting fungible and non-fungible tokens in one covenant deployment. Includes `identifierType` (PUBKEY/SCRIPT_HASH/COVENANT_ID) for KCC-0020 compatibility, `token_kind` for distinguishing fungible from non-fungible, `extended_state_digest` for extensibility, and a `metadata_uri` field. Twelve entrypoints cover the full token lifecycle: transfer, mint, burn, approve/transfer_from, metadata, royalties, freeze, supply caps, and ownership transfer.

**Token Lifecycle Standards (KCC-0009 through 0015)**

| KCC | Standard | Purpose |
|-----|----------|---------|
| 0009 | Governed Token | N-of-M multi-party approval for every transfer. Propose → Second → Execute lifecycle with execution delay and optional veto. |
| 0010 | Fee-on-Transfer Token | Automatic revenue sharing on every transfer. Configurable fee schedule (multi-recipient, basis points). Covenant-enforced — no off-chain settlement. |
| 0011 | Conditional Token | Oracle-gated transfers. Locked until an oracle attests a condition (price threshold, block reached, milestone attested). Atomic check-and-transfer. |
| 0012 | Testamentary Tokens | Death-triggered inheritance, will-based distribution, and fiduciary trust. Three sub-standards with death confirmation (oracle/social/inactivity). |
| 0013 | Real World Asset Token | KYC-gated fractional ownership of off-chain assets. Six asset profiles (real estate, commodities, fine art, IP, trade finance, carbon credits). Oracle-verified NAV. |
| 0014 | Soulbound Token | Non-transferable identity and credentials. KYC/credential/membership/license. Fixed 42-byte verify() output for cross-covenant gating. |
| 0015 | Vesting Token | Time-locked release with cliff, linear, streaming, and milestone schedules. Claim locks to transfer path separation. Optional clawback. |

### Layer 2: Infrastructure (KCC-0016 through 0018)

**KCC-0016 — Covenant ABI**
Binary interface discovery format embedded in covenant descriptors. Complete type system (12 types) with parameter serialization rules. Enables wallets and indexers to auto-discover covenant interfaces without source access.

**KCC-0017 — Oracle Attestation Format**
Standard 169-byte signed attestation blob. Rational price encoding (numerator/denominator). Length-prefixed bundle format. Five-step verification flow (format, pair, freshness, signature, registry). Integration examples for KCC-0011 and KCC-0013.

**KCC-0018 — Oracle Registry**
Operator lifecycle covenant (128-byte operator entries). Twelve entrypoints: apply, approve, activate, suspend, reinstate, revoke, reject, exit, heartbeat, set_backup, verify_diversity, set_price_floor. Bond economics with slashing. Heartbeat-based auto-suspension. Operator verification interface for consuming contracts.

### Layer 3: Commerce Conventions (KCC-0019, 0022 through 0024)

**KCC-0019 — Legal Signaling**
Six sub-conventions forming the signaling layer for legal agreements: Offer (proposal/acceptance), Redline (document markup), ConditionalAccept (cross-reference acceptance), ConsensusRecord (multi-party fact agreement), ConsensusSignal (condition/breach/deferral/waiver tracking), MultiPartyExecute (sequential multi-signature execution).

**KCC-0022 — ISDA Derivatives Convention**
Five sub-conventions implementing ISDA Master Agreement architecture: Master, Confirmation, Netting, Close-Out, Collateral/CSA. Supports SOFR/EURIBOR/SONIA rate fixing, netting math, and margin calls.

**KCC-0023 — Lending and Collateral**
Three sub-conventions: LMA Facility (syndicated loans), MRA (repurchase agreements), GMSLA (securities lending). Collateral margin maintenance, recall mechanics, and oracle-driven interest calculation.

**KCC-0024 — Trade Finance**
Two sub-conventions: UCP600 (letters of credit, 5-day examination window, hash-based document verification) and Incoterms (EXW/FOB/CIF/DDP delivery terms with risk transfer and customs obligations).

---

## Relationship to Existing KCCs

| KCC | Author | Our Reference |
|-----|--------|---------------|
| 0001 | IzioDev | Covenant definition, byte layout, Program ABI — cross-referenced in KCC-0016 |
| 0002 | IzioDev | Control principal references — `identifier_type` maps to this concept |
| 0020 | Manyfest, IzioDev | KCC-0020 transfer convention — foundation layer extended by all token specs |
| 0021 | Knitser | Metadata convention (live on kascov) — referenced by KCC-0008 metadata_uri |
| 0402 | Kali123411 | Payment channels — complementary infrastructure |

---

## Index

| Number | Category | Title | Author | Status |
|--------|----------|-------|--------|--------|
| KCC-0008 | Asset Standard | Multi-Token Standard | Vida Wallet | Draft |
| KCC-0009 | Asset Standard | Governed Token — Multi-Party Transfer Approval | Vida Wallet | Draft |
| KCC-0010 | Asset Standard | Fee-on-Transfer Token — Automatic Revenue Sharing | Vida Wallet | Draft |
| KCC-0011 | Asset Standard | Conditional Token — Oracle-Gated Transfers | Vida Wallet | Draft |
| KCC-0012 | Asset Standard | Testamentary Tokens — Inheritance, Will, and Trust | Vida Wallet | Draft |
| KCC-0013 | Asset Standard | Real World Asset Token | Vida Wallet | Draft |
| KCC-0014 | Asset Standard | Soulbound Token — Non-Transferable Identity | Vida Wallet | Draft |
| KCC-0015 | Asset Standard | Vesting Token — Time-Locked Release | Vida Wallet | Draft |
| KCC-0016 | Interoperability | Covenant ABI — Interface Discovery | Vida Wallet | Draft |
| KCC-0017 | Interoperability | Oracle Attestation Format | Vida Wallet | Draft |
| KCC-0018 | Covenant Convention | Oracle Registry — Operator Lifecycle | Vida Wallet | Draft |
| KCC-0019 | Covenant Convention | Legal Signaling — Offer, Redline, Consensus | Vida Wallet | Draft |
| KCC-0022 | Covenant Convention | ISDA Master Agreement — Derivatives | Vida Wallet | Draft |
| KCC-0023 | Covenant Convention | Lending and Collateral — LMA, MRA, GMSLA | Vida Wallet | Draft |
| KCC-0024 | Covenant Convention | Trade Finance — UCP600 and Incoterms | Vida Wallet | Draft |

---

## Status Definitions

- **Draft**: Under active development. Open for comment.
- **Proposed**: Submitted for ecosystem review.
- **Accepted**: Convergence point reached.
- **Deprecated**: Superseded or withdrawn.