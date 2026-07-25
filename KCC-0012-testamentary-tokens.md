# KCC-0012: Testamentary Token Standards

| Field | Value |
|-------|-------|
| **KCC** | 0012 |
| **Category** | Asset Standard |
| **Title** | Testamentary Tokens — Inheritance, Will, and Trust |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-25 |

## Abstract

Three token standards for conditional transfer upon death or per fiduciary terms. No blockchain has standardized testamentary instruments as token mechanics.

---

## Standard A: Inheritance — Dead Man's Switch

Tokens auto-transfer to a designated heir when death is confirmed.

| # | Entrypoint | Description |
|---|-----------|-------------|
| 1 | `set_heir` | Owner designates heir + confirmation method |
| 2 | `heartbeat` | Owner proves alive |
| 3 | `confirm_death` | Heir triggers confirmation |
| 4 | `claim` | Heir claims after confirmation + delay |

**Confirmation methods:** Oracle (death certificate attestation), social recovery (N-of-M guardians), inactivity (no heartbeat for N blocks).

**State:** `owner, heir, confirmation_method, inactivity_blocks, last_heartbeat, delay_blocks`

---

## Standard B: Will — Testamentary Distribution

Multi-beneficiary distribution per testator's terms, managed by an executor.

| # | Entrypoint | Description |
|---|-----------|-------------|
| 1 | `set_beneficiaries` | Define shares per beneficiary |
| 2 | `confirm_death` | As above |
| 3 | `distribute` | Executor distributes per will |
| 4 | `contest` | Beneficiary contests (bond required) |
| 5 | `resolve` | Notary resolves contest |

**State:** `testator, executor, beneficiaries: [{pubkey, share_bps}], notary`

---

## Standard C: Trust — Fiduciary Trust

Trustee holds and manages tokens for beneficiaries per trust terms.

| # | Entrypoint | Description |
|---|-----------|-------------|
| 1 | `settle` | Settlor transfers tokens into trust |
| 2 | `manage` | Trustee rebalances within terms |
| 3 | `distribute` | Trustee distributes per schedule |
| 4 | `replace_trustee` | Settlor or beneficiaries replace trustee |
| 5 | `enforce` | Beneficiary challenges via notary |
| 6 | `terminate` | Trust ends → distribute remainder |

**State:** `settlor, trustee, beneficiaries: [{pubkey, share_bps, schedule}], terms_hash, end_date, notary`

---

## Common Rules

1. Death confirmation requires at least one valid method.
2. A delay after confirmation prevents false triggers.
3. Distribution must match will/trust terms exactly.
4. Contests require bond.
5. Notaries resolve disputes per covenant convention.