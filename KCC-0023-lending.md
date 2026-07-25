# KCC-0023: Lending and Collateral Conventions

| Field | Value |
|-------|-------|
| **KCC** | 0023 |
| **Category** | Covenant Convention |
| **Title** | Lending, Repo, and Securities Lending — state layouts, pricing, collateral, recall |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-24 |
| **Updated** | 2026-07-25 |

## Abstract

Three covenants covering the core institutional lending markets: **LMAFacility** (syndicated loans, ~$4T annual volume), **MRA** (master repurchase agreement, ~$5T daily volume), and **GMSLA** (global master securities lending agreement, ~$2.5T on loan). Each covenant defines a byte-level state layout, entrypoint signatures with parameter types, rules per entrypoint, and a descriptor for wallet/indexer discovery. All three compose with OracleRegistry (rate fixing), ConsensusSignal (default/breach signaling), and CommerceFeeCovenant (fee collection).

## Motivation

Institutional lending is the largest single market in finance, yet no blockchain covenant standard exists for the three dominant agreement types. Syndicated loans, repos, and securities lending share common architectural needs — collateral margin maintenance, interest accrual from oracle rates, recall mechanics, and default handling — but differ in their economic primitives. A single convention covering all three avoids fragmentation while keeping each sub-convention specialized. Wallets, DEXes, and indexers integrate once against this convention and gain access to all three lending markets.

## Specification

### 1. LMAFacility — Syndicated Loan Facility

A committed revolving credit facility. The lender (syndicate, represented by a facility agent) commits a pool of capital. The borrower draws down against the pool. Interest accrues at a reference rate plus spread. Repayment follows a schedule. Collateral is posted and maintained at margin.

#### 1.1 State Layout

Every LMAFacility covenant state begins with the following fields, in this order and encoding:

```
offset  size    field                    encoding
0       8       facility_amount          uint64, big-endian
8       8       drawn_amount             uint64, big-endian
16      8       currency_token_id        uint64, big-endian
24      1       rate_reference           byte (enum, see §4)
25      4       rate_spread_bps          uint32, big-endian
29      8       last_accrual_block       uint64, big-endian
37      8       accrued_interest         uint64, big-endian
45      8       total_repaid             uint64, big-endian
53      1       repayment_phase          byte (index into repayment schedule)
54      8       next_payment_block       uint64, big-endian
62      8       maturity_block           uint64, big-endian
70      1       collateral_type          byte (enum, see §4)
71      8       collateral_amount        uint64, big-endian
79      4       haircut_bps              uint32, big-endian
83      8       margin_threshold_bps     uint64, big-endian
91      32      lender_id                bytes32
123     32      borrower_id              bytes32
155     32      facility_agent_id        bytes32
187     1       governing_law            byte (enum, see §4)
188     1       status                   byte (enum, see §4)
189     1       flags                    byte (bitfield, see §4)
190     32      extended_state_digest          bytes32
```

Total: **222 bytes**.

**rate_reference** — identifies the floating rate benchmark:

```
SOFR        = 0x00  // Secured Overnight Financing Rate (USD)
EURIBOR     = 0x01  // Euro Interbank Offered Rate (EUR)
SONIA       = 0x02  // Sterling Overnight Index Average (GBP)
TIBOR       = 0x03  // Tokyo Interbank Offered Rate (JPY)
FIXED       = 0xFF  // Fixed rate (rate_spread_bps is the absolute rate)
```

**repayment_phase** — index into the facility agent's published repayment schedule. The schedule itself is stored off-chain (referenced by the facility agent's descriptor) to keep covenant state compact. The phase increments atomically as each scheduled payment is made.

**collateral_type** — what is posted:

```
CASH        = 0x00  // cash in currency_token_id
TOKEN       = 0x01  // fungible token (token_id in first 8 bytes of extended_state_digest)
NFT         = 0x02  // non-fungible token (token_id in extended_state_digest)
CROSS_MARGIN= 0x03  // portfolio margin (extended_state_digest references basket)
```

**margin_threshold_bps** — the collateralization ratio requirement expressed in basis points. A value of 15000 means 150%: the collateral value (after haircut) must be at least 1.5× the drawn amount.

**Interest accrual formula:**

```
blocks_elapsed = current_block - last_accrual_block
ref_rate       = OracleRegistry.rate_lookup(rate_reference, currency_token_id)
// ref_rate_bps and rate_spread_bps are both in basis points
new_interest   = (drawn_amount * (ref_rate_bps + rate_spread_bps) * blocks_elapsed) / (365 * 86400 * 10000)
```

**Collateral maintenance check:**

```
collateral_value    = collateral_amount * (10000 - haircut_bps) / 10000
required_collateral = drawn_amount * margin_threshold_bps / 10000
margin_breach       = collateral_value < required_collateral
```

#### 1.2 Entrypoints

##### execute

```
execute(
    uint64  facility_amount,
    uint64  currency_token_id,
    byte    rate_reference,
    uint32  rate_spread_bps,
    bytes32 lender_id,
    bytes32 borrower_id,
    bytes32 facility_agent_id,
    byte    governing_law
)
```

Initializes the facility. Caller must be the facility agent.

Rules:
1. `facility_amount` must be > 0.
2. `currency_token_id` must reference an existing KCC-0008 fungible token.
3. The facility agent's signature must authorize the state creation.
4. Both `lender_id` and `borrower_id` must be valid account identifiers.
5. `governing_law` must be ENGLISH (0x00) or NY (0x01).
6. On success: `status = ACTIVE`, `drawn_amount = 0`, `accrued_interest = 0`, `last_accrual_block = current_block`.

##### drawdown

```
drawdown(
    uint64 amount,
    byte    collateral_type,
    uint64  collateral_amount,
    uint32  haircut_bps,
    uint64  margin_threshold_bps,
    uint64  next_payment_block,
    uint64  maturity_block,
    byte    repayment_phase
)
```

Borrower draws from the committed pool. Caller must be the borrower.

Rules:
1. `amount + drawn_amount` must be ≤ `facility_amount`.
2. Collateral must be posted: `collateral_amount` must satisfy the margin check given `haircut_bps` and `margin_threshold_bps`.
3. Collateral must be locked in the covenant state (the borrower loses spend authority over the collateral UTXO via KCC-0020 Borrowed Receive).
4. `maturity_block` must be > `current_block`.
5. `next_payment_block` must be > `current_block` and < `maturity_block`.
6. On success: `drawn_amount` increases by `amount`, `last_accrual_block = current_block`, collateral state fields are set.

##### repay

```
repay(
    uint64 amount
)
```

Borrower repays principal plus accrued interest. Caller must be the borrower.

Rules:
1. The caller must transfer `amount` to the covenant (via KCC-0020 transfer with the covenant as recipient).
2. Interest accrued since `last_accrual_block` is calculated first using the formula in §1.1.
3. `amount` first satisfies `accrued_interest + new_interest`, then reduces `drawn_amount`.
4. If `amount` exceeds `accrued_interest + new_interest + drawn_amount`, the excess is rejected (overpayment protection).
5. On success: `drawn_amount` decreases, `accrued_interest` is cleared, `total_repaid` increases, `status` advances to the next `repayment_phase` if the schedule milestone is met.
6. If `drawn_amount == 0` after repayment, `status = REPAID`.

##### accrue_interest

```
accrue_interest()
```

Facility agent records interest. Caller must be the facility agent.

Rules:
1. Computes interest since `last_accrual_block` per the formula in §1.1.
2. Adds the computed interest to `accrued_interest`.
3. Updates `last_accrual_block = current_block`.
4. Fails if `status != ACTIVE`.

##### default

```
default(
    bytes32 consensus_signal_id
)
```

Declares an event of default. Caller must be the facility agent OR the lender.

Rules:
1. `consensus_signal_id` must reference a valid ConsensusSignal (KCC-0019) in `breach` state.
2. The ConsensusSignal breach must reference this facility's covenant ID.
3. `status` must be `ACTIVE`.
4. On success: `status = IN_DEFAULT`, acceleration is triggered (full outstanding amount becomes due), collateral is frozen for liquidation by the lender.

##### close

```
close()
```

Closes the facility. Caller must be the facility agent.

Rules:
1. `status` must be `REPAID` or `IN_DEFAULT`.
2. If `REPAID`: collateral is released back to borrower.
3. If `IN_DEFAULT`: collateral is transferred to lender (liquidation).
4. On success: `status = CLOSED`, flags set to terminal.

#### 1.3 Descriptor

```
LMAFacilityDescriptor {
    prefix: bytes              // covenant script bytes before mutable state
    suffix: bytes              // covenant script bytes after mutable state
    lma_version: string        // "LMA.2024" or later
    schedule_uri: string       // URI to repayment schedule document
    flags: uint8               // 0x01 = REVOLVING, 0x02 = TERM
}
```

### 2. MRA — Master Repurchase Agreement

A sale-and-repurchase transaction. The seller (cash borrower) sells securities to the buyer (cash lender) at the purchase price, with an obligation to repurchase them at a higher repurchase price. The difference is the repo interest. Collateral is maintained at margin throughout.

#### 2.1 State Layout

```
offset  size    field                    encoding
0       8       purchase_price           uint64, big-endian
8       8       repurchase_price         uint64, big-endian
16      8       principal                uint64, big-endian
24      8       currency_token_id        uint64, big-endian
32      4       repo_rate_bps            uint32, big-endian
36      8       purchase_block           uint64, big-endian
44      8       maturity_block           uint64, big-endian
52      8       securities_token_id      uint64, big-endian
60      8       securities_quantity       uint64, big-endian
68      4       haircut_bps              uint32, big-endian
72      8       margin_threshold_bps     uint64, big-endian
80      1       collateral_type          byte (enum, see §4)
81      8       collateral_amount        uint64, big-endian
89      32      seller_id                bytes32
121     32      buyer_id                 bytes32
153     1       governing_law            byte (enum, see §4)
154     1       status                   byte (enum, see §4)
155     1       flags                    byte (bitfield, see §4)
156     32      extended_state_digest          bytes32
```

Total: **188 bytes**.

**Repo pricing formula** — the repurchase price MUST exceed the purchase price. The difference is the repo interest:

```
days           = max((maturity_block - purchase_block) / 86400, 1)
annual_rate    = repo_rate_bps / 10000
interest       = purchase_price * annual_rate * days / 365
repurchase_price = purchase_price + interest
```

For overnight repos (`maturity_block - purchase_block < 86400`), `days` is floored at 1 to ensure positive interest. For term repos, the exact block delta is divided by the number of blocks per day (86400 on Kaspa at 1 BPS).

**Verification invariant:**

```
repurchase_price > purchase_price   // enforced at execute and repurchase_leg
```

**Collateral maintenance check** (identical to LMA, applied to the securities side):

```
collateral_value    = collateral_amount * (10000 - haircut_bps) / 10000
required_collateral = principal * margin_threshold_bps / 10000
margin_breach       = collateral_value < required_collateral
```

#### 2.2 Entrypoints

##### execute

```
execute(
    uint64  principal,
    uint64  currency_token_id,
    uint32  repo_rate_bps,
    uint64  maturity_block,
    uint64  securities_token_id,
    uint64  securities_quantity,
    uint32  haircut_bps,
    uint64  margin_threshold_bps,
    bytes32 seller_id,
    bytes32 buyer_id,
    byte    governing_law
)
```

Initializes the repo. Caller must be the buyer (cash lender).

Rules:
1. `principal` must be > 0.
2. `repo_rate_bps` must be > 0 (positive interest — repurchase price must exceed purchase price).
3. `maturity_block` must be > `current_block`.
4. `currency_token_id` and `securities_token_id` must reference existing KCC-0008 tokens.
5. Both `seller_id` and `buyer_id` must be valid account identifiers.
6. `governing_law` must be ENGLISH (0x00) or NY (0x01).
7. On success: `status = PENDING`, `purchase_price = 0` (unset until purchase_leg), `purchase_block = 0`.

##### purchase_leg

```
purchase_leg(
    uint64 purchase_price,
    uint64 collateral_amount,
    byte   collateral_type
)
```

Buyer purchases the securities and pays cash. Caller must be the buyer.

Rules:
1. `purchase_price` must be ≤ `principal` (buyer pays up to the committed principal).
2. `status` must be `PENDING`.
3. The seller must deposit `securities_quantity` into the covenant (via KCC-0020 transfer with the covenant as recipient).
4. Buyer transfers `purchase_price` in `currency_token_id` to the seller.
5. Collateral must satisfy the margin check: `collateral_amount * (10000 - haircut_bps) / 10000 >= principal * margin_threshold_bps / 10000`.
6. The **repurchase price** is computed at this point: `repurchase_price = purchase_price * (1 + repo_rate_bps / 10000 * days / 365)` and stored immutably.
7. Invariant: `repurchase_price > purchase_price` is enforced.
8. On success: `status = ACTIVE`, `purchase_block = current_block`.

##### repurchase_leg

```
repurchase_leg(
    uint64 amount
)
```

Seller repurchases the securities at maturity. Caller must be the seller.

Rules:
1. `amount` must equal `repurchase_price` exactly.
2. `status` must be `ACTIVE`.
3. Seller transfers `amount` to the covenant. The covenant forwards `repurchase_price` to the buyer.
4. Securities are released back to the seller.
5. Collateral is released to the seller.
6. On success: `status = SETTLED`.
7. If `current_block > maturity_block` and seller has not called `repurchase_leg`, a `margin_call` or `default` is implied (enforced by the buyer).

##### margin_call

```
margin_call(
    uint64 additional_collateral
)
```

Buyer demands additional collateral. Caller must be the buyer.

Rules:
1. `status` must be `ACTIVE`.
2. The current `collateral_value` must be below `required_collateral` (per the formula in §2.1), OR `current_block > maturity_block` and `repurchase_leg` has not been called.
3. Seller must post `additional_collateral` within the margin call window (default: 1 business day = 86400 blocks).
4. On success: `collateral_amount` increases by `additional_collateral`, margin check is re-verified.
5. If seller fails to post, buyer may call `default`.

##### default

```
default(
    bytes32 consensus_signal_id
)
```

Declares an event of default. Caller must be the buyer.

Rules:
1. `consensus_signal_id` must reference a valid ConsensusSignal (KCC-0019) in `breach` state referencing this repo's covenant ID.
2. `status` must be `ACTIVE`.
3. On success: `status = IN_DEFAULT`, securities are transferred to buyer (buyer keeps securities, seller forfeits collateral).

##### close

```
close()
```

Finalizes the repo. Caller must be the buyer.

Rules:
1. `status` must be `SETTLED` or `IN_DEFAULT`.
2. If `SETTLED`: any remaining state is cleaned up.
3. If `IN_DEFAULT`: buyer takes ownership of securities and collateral.
4. On success: `status = CLOSED`.

#### 2.3 Descriptor

```
MRADescriptor {
    prefix: bytes              // covenant script bytes before mutable state
    suffix: bytes              // covenant script bytes after mutable state
    mra_version: string        // "GMRA.2011" or later
    repo_type: uint8           // 0x00 = CLASSIC, 0x01 = SELL_BUY_BACK, 0x02 = TRI_PARTY
    is_open: bool              // true = open repo (no fixed maturity)
}
```

### 3. GMSLA — Global Master Securities Lending Agreement

Securities lending with collateral. The lender transfers securities to the borrower. The borrower posts collateral and pays a lending fee. The lender retains the right to recall the securities at any time. The borrower must return them within the agreed recall window.

#### 3.1 State Layout

```
offset  size    field                    encoding
0       8       loan_principal           uint64, big-endian
8       8       securities_token_id      uint64, big-endian
16      8       securities_quantity      uint64, big-endian
24      8       collateral_token_id      uint64, big-endian
32      8       collateral_amount        uint64, big-endian
40      4       haircut_bps              uint32, big-endian
44      8       margin_threshold_bps     uint64, big-endian
52      4       lending_fee_bps          uint32, big-endian
56      8       last_fee_payment_block   uint64, big-endian
64      8       recall_requested_block   uint64, big-endian
72      8       recall_window_blocks     uint64, big-endian
80      8       accrued_fee              uint64, big-endian
88      32      lender_id                bytes32
120     32      borrower_id              bytes32
152     1       governing_law            byte (enum, see §4)
153     1       status                   byte (enum, see §4)
154     1       flags                    byte (bitfield, see §4)
155     32      extended_state_digest          bytes32
```

Total: **187 bytes**.

**Lending fee formula:**

```
blocks_elapsed = current_block - last_fee_payment_block
annual_rate    = lending_fee_bps / 10000
fee            = loan_principal * annual_rate * blocks_elapsed / (365 * 86400)
```

**Collateral maintenance check:**

```
collateral_value    = collateral_amount * (10000 - haircut_bps) / 10000
required_collateral = loan_principal * margin_threshold_bps / 10000
margin_breach       = collateral_value < required_collateral
```

**Recall deadline calculation:**

```
recall_deadline = recall_requested_block + recall_window_blocks
recall_breached = (recall_requested_block != 0) AND (current_block > recall_deadline)
                  AND (securities not yet returned)
```

#### 3.2 Entrypoints

##### execute

```
execute(
    uint64  loan_principal,
    uint64  securities_token_id,
    uint64  securities_quantity,
    uint64  collateral_token_id,
    uint32  haircut_bps,
    uint64  margin_threshold_bps,
    uint32  lending_fee_bps,
    uint64  recall_window_blocks,
    bytes32 lender_id,
    bytes32 borrower_id,
    byte    governing_law
)
```

Initializes the securities lending agreement. Caller must be the lender.

Rules:
1. `loan_principal` must be > 0.
2. `securities_token_id` and `collateral_token_id` must reference existing KCC-0008 tokens.
3. `lending_fee_bps` must be > 0.
4. `recall_window_blocks` must be > 0 and ≤ 7 * 86400 (7 days — maximum recall window per GMSLA market practice).
5. Both `lender_id` and `borrower_id` must be valid account identifiers.
6. `governing_law` must be ENGLISH (0x00) or NY (0x01).
7. On success: `status = PENDING`, `recall_requested_block = 0`, `accrued_fee = 0`, `last_fee_payment_block = current_block`.

##### deliver

```
deliver(
    uint64 collateral_amount
)
```

Lender delivers securities; borrower posts collateral. Caller must be the lender.

Rules:
1. `status` must be `PENDING`.
2. Lender must deposit `securities_quantity` of `securities_token_id` into the covenant (via KCC-0020 transfer with the covenant as recipient).
3. Borrower must post `collateral_amount` of `collateral_token_id`.
4. Collateral must satisfy the margin check: `collateral_amount * (10000 - haircut_bps) / 10000 >= loan_principal * margin_threshold_bps / 10000`.
5. On success: `status = ACTIVE`, `collateral_amount` is set.

##### pay_fee

```
pay_fee(
    uint64 amount
)
```

Borrower pays the lending fee. Caller must be the borrower.

Rules:
1. `status` must be `ACTIVE`.
2. Fee is calculated per the formula in §3.1 since `last_fee_payment_block`.
3. `amount` must be ≥ accrued fee.
4. Borrower transfers `amount` to the lender via the covenant.
5. On success: `accrued_fee = 0`, `last_fee_payment_block = current_block`.
6. Failure to pay fees for > 30 days (2,592,000 blocks) constitutes an event of default discoverable via ConsensusSignal.

##### mark_to_market

```
mark_to_market(
    uint64 new_collateral_amount,
    bool   return_excess          // true = lender returns excess to borrower
)
```

Updates collateral to reflect current market value. Caller may be either party.

Rules:
1. `status` must be `ACTIVE`.
2. The caller must provide an oracle attestation (KCC-0018) for the current price of `securities_token_id`.
3. `new_collateral_amount` is computed as `loan_principal * margin_threshold_bps / 10000 * 10000 / (10000 - haircut_bps)` rounded up, where `loan_principal` is re-valued using the oracle price.
4. If `new_collateral_amount > collateral_amount`: borrower must post the difference (margin call).
5. If `new_collateral_amount < collateral_amount` and `return_excess == true`: lender returns excess collateral to borrower.
6. On success: `collateral_amount = new_collateral_amount`.
7. Either party may call `mark_to_market` at any time; the covenant enforces the math, not who called it.

##### recall

```
recall()
```

Lender recalls the securities. Caller must be the lender.

Rules:
1. `status` must be `ACTIVE`.
2. `recall_requested_block` must be 0 (only one recall at a time; subsequent recalls require a new agreement or re-delivery).
3. On success: `recall_requested_block = current_block`.
4. The borrower now has `recall_window_blocks` to call `return_securities`.

The recall is **unconditional** — the lender does not need to state a reason. This mirrors the GMSLA provision that the lender may recall "at any time." The borrower's obligation to return is absolute once recall is requested.

##### return_securities

```
return_securities()
```

Borrower returns the securities. Caller must be the borrower.

Rules:
1. `status` must be `ACTIVE`.
2. If `recall_requested_block != 0`: `current_block` must be ≤ `recall_requested_block + recall_window_blocks`. If the deadline has passed, this entrypoint fails and the lender must call `default`.
3. Borrower returns `securities_quantity` of `securities_token_id` to the covenant. The covenant forwards to the lender.
4. All accrued fees must be paid (enforced: `accrued_fee == 0`).
5. Collateral is released back to the borrower.
6. On success: `status = RETURNED`.

**Recall breach scenario:**

```
If recall_requested_block != 0
   AND current_block > recall_requested_block + recall_window_blocks
   AND return_securities has not been called
Then: lender may call default()
       status = IN_DEFAULT
       collateral is forfeited to lender
```

##### default

```
default(
    bytes32 consensus_signal_id
)
```

Declares an event of default. Caller must be the lender.

Rules:
1. `consensus_signal_id` must reference a valid ConsensusSignal (KCC-0019) in `breach` state referencing this GMSLA's covenant ID. Valid breach reasons include:
   - Recall deadline exceeded (borrower did not return within `recall_window_blocks`)
   - Fee payment delinquency (> 30 days)
   - Margin call failure
   - Borrower insolvency signal
2. `status` must be `ACTIVE`.
3. On success: `status = IN_DEFAULT`, collateral is transferred to lender, securities are returned to lender (or lender keeps them if already in possession).

##### close

```
close()
```

Finalizes the agreement. Caller may be either party.

Rules:
1. `status` must be `RETURNED` or `IN_DEFAULT`.
2. If `RETURNED`: all state is cleaned, any residual amounts returned.
3. If `IN_DEFAULT`: lender takes collateral, borrower's obligation is extinguished.
4. On success: `status = CLOSED`.

#### 3.3 Descriptor

```
GMSLADescriptor {
    prefix: bytes              // covenant script bytes before mutable state
    suffix: bytes              // covenant script bytes after mutable state
    gmsla_version: string      // "GMSLA.2010" or later
    is_open_ended: bool        // true = no fixed term, lender can recall anytime
    min_recall_blocks: uint64  // minimum recall window this deployment accepts
}
```

### 4. Enumerated Types

Shared across all three sub-conventions.

**Status values:**

```
PENDING     = 0x00  // agreement initialized, not yet active
ACTIVE      = 0x01  // live, obligations in force
REPAID      = 0x02  // LMA only: drawn amount fully repaid
SETTLED     = 0x03  // MRA only: repurchase completed
RETURNED    = 0x04  // GMSLA only: securities returned
IN_DEFAULT  = 0xFD  // event of default declared
CLOSED      = 0xFE  // terminal: agreement finalized
```

**Governing law:**

```
ENGLISH     = 0x00  // English law (LMA, GMSLA, GMRA)
NY          = 0x01  // New York law (alternate for all three)
```

**Collateral type** (see §1.1):

```
CASH        = 0x00
TOKEN       = 0x01
NFT         = 0x02
CROSS_MARGIN= 0x03
```

**Rate reference** (see §1.1):

```
SOFR        = 0x00
EURIBOR     = 0x01
SONIA       = 0x02
TIBOR       = 0x03
FIXED       = 0xFF
```

**Flags bitfield** (used by all three sub-conventions):

```
the token configuration frozen flag          = 0x01  // all operations suspended (admin action)
BIT_COLLATERAL_LOCKED = 0x02  // collateral cannot be withdrawn
BIT_RECALL_ACTIVE   = 0x04  // GMSLA: recall has been requested
BIT_TERMINAL        = 0x80  // state is terminal, no further transitions
```

## Encoding

The state layout tables in §1.1, §2.1, and §3.1 define the canonical byte encoding for each sub-convention. All multi-byte integers are **big-endian**. All `bytes32` fields are raw 32-byte values with no length prefix. Enumerated types are encoded as single bytes. The `extended_state_digest` field commits to covenant-specific extended state beyond the standard header, computed as:

```
extended_state_digest = blake2b(encode(extended_state))
```

For the transfer entrypoints used during collateral posting, drawdown, and repayment, these covenants adopt the KCC-0020 leader/delegator pattern. Wallets and indexers MUST use the `prefix` and `suffix` fields from each sub-convention's descriptor to identify the covenant template and decode its state.

## KCC-0020 Alignment

All three sub-conventions adopt the following from KCC-0020:

- **Transfer interface**: When collateral, securities, or cash moves between parties, the KCC-0020 `transfer(State[], Sig[], byte[])` / `transfer_delegator()` leader/delegator pattern is used for the KCC-0008 token states involved.
- **Borrowed Receive**: Collateral and securities are locked into the lending covenant via `witnesses[i] == 0xFF`, which exempts the depositing party from owner authorization while preserving token integrity. This allows the covenant to hold assets without being the token owner.
- **Positional input/output pairing**: consumed token states at index `i` correspond to successor token states at index `i`.
- **Extended state**: each sub-convention maintains an `extended_state_digest` committed via blake2b, allowing sub-convention-specific extensions without breaking the standard header.

Where these sub-conventions extend KCC-0020:

- **Covenant-level state**: Unlike KCC-0020 which governs individual token states, these lending covenants maintain aggregate facility/repo/loan state with economic primitives (interest, margin, recall, default).
- **Oracle-driven computation**: Interest rates, margin thresholds, and mark-to-market values depend on external oracle data, not purely on-chain arguments.
- **ConsensusSignal integration**: Default and breach are declared via KCC-0019 ConsensusSignal, not inferred solely from covenant state.
- **Time-based obligations**: Maturity, recall windows, fee payment intervals — all driven by block height.

## Composability

### OracleRegistry (KCC-0018)

- **LMAFacility**: `rate_reference` lookups (SOFR, EURIBOR, SONIA, TIBOR) are resolved via `OracleRegistry.rate_lookup(reference, currency_token_id)`. The facility agent's `accrue_interest` entrypoint fetches the current reference rate from an ACTIVE oracle operator's attestation.
- **MRA**: The repurchase price formula uses the repo rate set at execution (no ongoing oracle lookup), but collateral mark-to-market during `margin_call` requires oracle price attestations for the securities token.
- **GMSLA**: The `mark_to_market` entrypoint requires an oracle attestation (KCC-0018) for the current price of `securities_token_id` to compute the updated `collateral_amount`.

### ConsensusSignal (KCC-0019)

- **LMAFacility**: The `default` entrypoint requires a `consensus_signal_id` in `breach` state, validated against this facility's covenant ID. Valid breach signals include: payment default, covenant breach, cross-default, insolvency.
- **MRA**: Same pattern — `default` is gated on a valid ConsensusSignal breach referencing the repo's covenant ID. Triggers include: failure to repurchase, margin call failure, seller insolvency.
- **GMSLA**: `default` requires a ConsensusSignal breach for: recall deadline exceeded, fee delinquency (> 30 days), margin call failure, or borrower insolvency.

### CommerceFeeCovenant

All three sub-conventions route fee payments through the CommerceFeeCovenant:

- **LMA**: Facility agent fees, commitment fees, and arrangement fees.
- **MRA**: Repo interest (the difference between repurchase and purchase price) is split between buyer and the fee covenant per the configured basis-point schedule.
- **GMSLA**: Lending fees paid by the borrower are routed through the fee covenant; the lender receives the net amount after the fee covenant's deduction.

### MultiPartyExecute (KCC-0019)

- **LMAFacility**: Syndicated loan execution may involve multiple lenders signing the `execute` entrypoint via MultiPartyExecute before the facility becomes active.

## Profiles

Wallets and DEXes detect lending covenant behavior from the descriptor prefix:

| Profile | Detection | Key Entrypoints |
|---------|-----------|----------------|
| **LMA** | descriptor prefix matches LMAFacility | execute, drawdown, repay, accrue_interest, default |
| **MRA** | descriptor prefix matches MRA | execute, purchase_leg, repurchase_leg, margin_call, default |
| **GMSLA** | descriptor prefix matches GMSLA | execute, deliver, pay_fee, mark_to_market, recall, return_securities, default |

## Rules

### General

1. All lending covenants MUST specify `governing_law` as ENGLISH (0x00) or NY (0x01). No other governing law is recognized.
2. Collateral margin MUST be maintained at all times while `status == ACTIVE`. A breach — where `collateral_value < required_collateral` — triggers the non-breaching party's right to call `margin_call` (MRA/GMSLA) or `default` (any).
3. All state-changing entrypoints fail while `the token configuration frozen flag` is set.
4. `BIT_TERMINAL` states (CLOSED) are immutable — no further transitions permitted.

### LMAFacility

5. Drawn amount MUST NOT exceed facility amount at any time.
6. Interest MUST be accrued at the reference rate + spread before any repayment is applied to principal.
7. Repayment amounts MUST first satisfy accrued interest, then reduce principal.
8. The facility agent MUST calculate repayment amounts using oracle rate data from an ACTIVE OracleRegistry operator.
9. Collateral MUST be released to the borrower upon full repayment (`status = REPAID`).

### MRA

10. Repurchase price MUST exceed purchase price. The covenant enforces `repurchase_price > purchase_price` at `purchase_leg` and `repurchase_leg`.
11. The repurchase price formula (§2.1) is immutable after `purchase_leg` executes — the rate and term are locked.
12. The buyer (cash lender) holds the securities during the repo term; the seller (cash borrower) holds the cash.
13. If the seller fails to repurchase by maturity, the buyer may call `margin_call` or `default`.
14. On default, securities transfer to buyer and collateral is forfeited.

### GMSLA

15. The lender MAY recall securities at any time by calling `recall()`. No reason is required.
16. Upon recall, the borrower MUST call `return_securities` within `recall_window_blocks` of `recall_requested_block`.
17. If the borrower fails to return within the recall window, the lender may call `default()` with a ConsensusSignal breach.
18. Lending fees MUST be paid by the borrower. Fee delinquency exceeding 30 days (2,592,000 blocks) is a default event.
19. Collateral is marked to market via oracle price attestations. Either party may call `mark_to_market`.
20. Collateral type (`collateral_token_id`) is fixed at `deliver` and cannot change for the life of the agreement.

## Reference

The author maintains conforming SilverScript implementations for each sub-convention. This document defines the convention; implementations demonstrate conformance.

- **LMAFacility** is based on the Loan Market Association's "LMA Recommended Form of Facility Agreement" for syndicated lending.
- **MRA** is based on the International Capital Market Association's "Global Master Repurchase Agreement (GMRA 2011)."
- **GMSLA** is based on the International Securities Lending Association's "Global Master Securities Lending Agreement (GMSLA 2010)."