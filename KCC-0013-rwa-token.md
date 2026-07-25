# KCC-0013: Real World Asset Token Standard

| Field | Value |
|-------|-------|
| **KCC** | 0013 |
| **Category** | Asset Standard |
| **Title** | RWA Token — Tokenized Real World Assets |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |

## Abstract

A standard for tokenizing real-world assets. Each token represents fractional ownership. The covenant enforces KYC-gated transfers, oracle-verified asset state, income distribution, redemption rights, and custodian obligations.

## Core Interface

| # | Entrypoint | Caller | Description |
|---|-----------|--------|-------------|
| 1 | `mint` | Issuer | Tokenize verified asset |
| 2 | `transfer` | Holder | Transfer to KYC-verified recipient |
| 3 | `distribute_income` | Custodian | Pro-rata income to holders |
| 4 | `redeem` | Holder | Burn tokens, claim underlying asset |
| 5 | `verify_asset` | Oracle | Update valuation, condition |
| 6 | `freeze` | Custodian | Regulatory compliance |

**Core state:** `asset_class, asset_description, jurisdiction, custodian, oracle, total_supply, nav_per_token, kyc_required`

## Asset Profiles

### Real Estate
Additional state: `address, sq_meters, title_ref`. Income: rent. Redemption: majority holder forces sale.

### Commodities
Additional state: `warehouse, grade, weight_kg, warehouse_receipt`. Income: storage rebate. Redemption: physical delivery.

### Fine Art
Additional state: `artist, medium, provenance`. Income: exhibition fees. Redemption: single-token = full ownership.

### Intellectual Property
Additional state: `ip_type, registration, territory, expiry`. Income: royalties. Redemption: license transfer.

### Trade Finance
Additional state: `debtor, face_value, due_date, invoice_hash`. Income: discount. Redemption: collect from debtor at maturity.

### Carbon Credits
Additional state: `registry, vintage, project_type, serial`. No income. Redemption: retire credit.

## Encoding

For the technical encoding of transfer operations, state field ordering, witness semantics, and positional input/output pairing, see KCC-0020 (Fungible Token Covenant Specification by Manyfest, Michael Sutton, and IzioDev). This standard defines the interface; KCC-0020 defines the byte-level implementation.

## Rules

1. Minting requires oracle attestation of asset existence.
2. `total_supply × nav_per_token` must equal audited asset value.
3. Custodian cannot hold tokens.
4. KYC must reference an approved identity oracle.