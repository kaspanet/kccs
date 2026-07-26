# KCC-0022: ISDA Derivatives Convention

| Field | Value |
|-------|-------|
| **KCC** | 0022 |
| **Category** | Covenant Convention |
| **Title** | ISDA Master Agreement — derivatives trading infrastructure |
| **Author** | Vida Wallet |
| **Status** | Informational |
| **Created** | 2026-07-24 |
| **Depends on** | KCC-0008 (PR #10, draft), KCC-0014 (PR #10, draft) |
| **Updated** | 2026-07-25 |

## Abstract

Five covenants implementing the ISDA Master Agreement architecture on Kaspa: ISDAMaster (parties, governing law, events of default), ISDAConfirmation (individual trade terms), ISDANetting (net settlement under Section 2(c)), ISDACloseOut (early termination under Section 6), and ISDACollateral/CSA (credit support annex — margin, haircuts, substitution). Each sub-convention defines byte-level state layouts, complete entrypoint signatures, and concrete enforcement rules. Together they govern the $600T+ global derivatives market on a covenant-native substrate.

## Motivation

Derivatives contracts are the largest financial market by notional outstanding. The ISDA Master Agreement, first published in 1992 and updated in 2002, provides the legal architecture — but settlement still relies on wire transfers, bilateral messaging, and manual reconciliation. Disputes over close-out amounts, netting calculations, and collateral valuations cost billions annually in legal fees alone.

A covenant-native ISDA implementation eliminates the gap between contract terms and settlement. The Master agreement governs which events trigger default. Confirmations record trade economics. Netting computes a single net payment. Close-Out calculates the termination amount on-chain. Collateral moves automatically when exposure crosses a threshold. Every rule is enforced at the consensus layer — no manual reconciliation, no disputed calculations, no settlement failure.

## Specification

### 1. ISDAMaster

The master agreement. Both parties sign. Events of default tracked. All confirmations, netting sets, close-out calculations, and collateral arrangements reference this master. One deployment per bilateral relationship.

#### State Layout

```
offset  size    field                   encoding
0       1       version                 uint8                           // 0x01
1       1       flags                   byte
2       1       governing_law           byte                            // see Governing Law enum
3       1       termination_currency    byte                            // see Currency enum
4       4       reserved                bytes (zero-filled)
8       32      party_a_id              bytes32                         // covenant or pubkey
40      32      party_b_id              bytes32                         // covenant or pubkey
72      8       created_at_block        uint64, big-endian
80      8       terminated_at_block     uint64, big-endian              // 0 = active
88      1       default_event_count     uint8                           // 0-255 tracked
89      1       cure_period_blocks      uint8                           // blocks to cure default, 0 = none
90      6       reserved                bytes (zero-filled)
96      64      master_agreement_uri    padded bytes64, UTF-8           // IPFS/Arweave link to full agreement
160     32      extended_state_digest         bytes32                         // blake2b(encode(master_extended))
```

Total: 192 bytes.

**flags** bitfield:

```
BIT_TERMINATED         = 0x01  // master has been terminated
BIT_MULTILATERAL       = 0x02  // more than 2 parties (MultiPartyExecute pattern)
BIT_CROSS_DEFAULT      = 0x04  // cross-default with other masters enabled
BIT_AUTOMATIC_EARLY    = 0x08  // Automatic Early Termination (AET) on bankruptcy
```

**governing_law** values:

```
ENGLISH_LAW    = 0x00  // ISDA 1992/2002 under English law
NEW_YORK_LAW   = 0x01  // ISDA 1992/2002 under New York law
JAPANESE_LAW   = 0x02  // ISDA 1992/2002 under Japanese law
```

**termination_currency** values:

```
USD  = 0x00
EUR  = 0x01
GBP  = 0x02
JPY  = 0x03
CHF  = 0x04
CAD  = 0x05
AUD  = 0x06
```

**party_a_id / party_b_id**: Identify the two counterparties. Each is a covenant ID (for institutional wallets) or a public key hash. The ordering is deterministic — party_a_id bytes, when interpreted as big-endian uint256, must be strictly less than party_b_id bytes.

#### Master Extended State

```
offset  size    field                   encoding
0       1       event_count             uint8                           // number of tracked events
1       3       reserved                bytes (zero-filled)
4       72*N    events                  MasterEvent[N]
```

**MasterEvent** record (72 bytes each):

```
offset  size    field                   encoding
0       1       event_type              byte                            // see EventType enum
1       1       event_status            byte                            // see EventStatus enum
2       6       reserved                bytes
8       8       declared_at_block       uint64, big-endian
16      8       cured_at_block          uint64, big-endian              // 0 = not yet cured
24      8       declaring_party         uint8                           // 0 = party_a, 1 = party_b
25      39      reserved                bytes
64      8       event_id                uint64, big-endian              // monotonic counter
```

**event_type** values:

```
FAILURE_TO_PAY            = 0x01  // Section 5(a)(i)
BREACH_OF_AGREEMENT       = 0x02  // Section 5(a)(ii)
CREDIT_SUPPORT_DEFAULT    = 0x03  // Section 5(a)(iii)
MISREPRESENTATION         = 0x04  // Section 5(a)(iv)
DEFAULT_UNDER_SPECIFIED   = 0x05  // Section 5(a)(v) — cross-default
CROSS_DEFAULT             = 0x06  // Section 5(a)(vi)
BANKRUPTCY                = 0x07  // Section 5(a)(vii)
MERGER_WITHOUT_ASSUMPTION = 0x08  // Section 5(a)(viii)
ILLEGALITY                = 0x10  // Section 5(b)(i) — termination event
FORCE_MAJEURE             = 0x11  // Section 5(b)(ii)
TAX_EVENT                 = 0x12  // Section 5(b)(iii)
TAX_EVENT_UPON_MERGER     = 0x13  // Section 5(b)(iv)
```

**event_status** values:

```
DECLARED   = 0x00  // event declared but not yet effective
CURED      = 0x01  // event cured within cure period
EFFECTIVE  = 0x02  // event is effective (not cured in time)
DISPUTED   = 0x03  // event disputed by counterparty
RESOLVED   = 0x04  // dispute resolved via ConsensusRecord
```

#### Entrypoints

##### execute

```
execute(
    bytes32 party_b_id,                 // counterparty identifier
    byte    governing_law,              // ENGLISH_LAW or NEW_YORK_LAW
    byte    termination_currency,       // settlement currency
    uint8   cure_period_blocks,         // blocks allowed to cure a default
    bytes   master_agreement_uri,       // link to full ISDA Master text
    bool    cross_default,              // enable cross-default provisions
    bool    automatic_early,            // enable AET
    sig[] sigs                  // one signature from each party
)
```

Initiates the master agreement. Rules:

1. Caller must be `party_a_id` (first signer); `party_b_id` must be provided and distinct.
2. `party_a_id` bytes < `party_b_id` bytes when interpreted as big-endian uint256 — ordering enforced.
3. `signatures` must contain exactly 2 valid signatures: one from `party_a_id`, one from `party_b_id`.
4. `governing_law` must be ENGLISH_LAW (0x00) or NEW_YORK_LAW (0x01).
5. If `automatic_early` is set, BIT_AUTOMATIC_EARLY is enabled.
6. On success: produces a single master UTXO with flags clear, `created_at_block = current_block`, `terminated_at_block = 0`, `default_event_count = 0`.
7. Fails if caller already has an active master with `party_b_id`.

For multilateral master agreements, use MultiPartyExecute (KCC-0019) to coordinate 3+ signatories.

##### declare_default

```
declare_default(
    byte    event_type,                 // from EventType enum
    Sig     signature                   // declaring party's signature
)
```

Declares an event of default or termination event. Rules:

1. Caller must be `party_a_id` or `party_b_id`.
2. `event_type` must be a valid EventType value.
3. If BIT_TERMINATED is set, fail — cannot declare default on terminated master.
4. If `event_type` is a Termination Event (ILLEGALITY, FORCE_MAJEURE, TAX_EVENT, TAX_EVENT_UPON_MERGER) and BIT_AUTOMATIC_EARLY is set: the event takes effect immediately (status = EFFECTIVE).
5. Otherwise: event is created with status = DECLARED, `declared_at_block = current_block`, `declaring_party` set.
6. `default_event_count` is incremented.
7. A ConsensusSignal (KCC-0019) is emitted with `condition = "default_declared"` referencing this master's covenant ID and the new event_id.
8. On AET bankruptcy (BANKRUPTCY + BIT_AUTOMATIC_EARLY): auto-triggers Close-Out calculation.

##### cure_default

```
cure_default(
    uint64  event_id,                   // event to cure
    Sig     signature                   // declaring party's signature (only they can cure)
)
```

Cures a declared default within the cure period. Rules:

1. `event_id` must reference an existing event with status = DECLARED.
2. Caller must be the declaring party (the party who called `declare_default`). Only the declaring party can cure.
3. `current_block - declared_at_block <= cure_period_blocks`. If outside: fail — must use `declare_default` with EFFECTIVE status or proceed to Close-Out.
4. On success: event status set to CURED, `cured_at_block = current_block`.
5. A ConsensusSignal is emitted with `condition = "default_cured"`.

##### terminate

```
terminate(
    sig[] sigs                  // both parties must sign
)
```

Mutual termination of the master agreement. Rules:

1. Both parties must sign (`signatures` must contain 2 valid signatures from party_a and party_b).
2. BIT_TERMINATED is set, `terminated_at_block = current_block`.
3. All active events are resolved (status = RESOLVED).
4. No new confirmations may reference this master after termination.
5. Existing confirmations remain valid — termination does not cancel outstanding trades. Use Close-Out for that.
6. Fails if any uncured EFFECTIVE defaults exist. Must resolve those first.

### 2. ISDAConfirmation

Individual derivative trade. Each confirmation references an ISDAMaster and records the economic terms of a single transaction: notional, rate type, payment frequency, maturity, calculation agent. Multiple confirmations under one master form a netting set.

#### State Layout

```
offset  size    field                       encoding
0       8       confirmation_id             uint64, big-endian              // unique per master
8       32      master_id                   bytes32                         // ISDAMaster covenant ID
40      32      party_a_id                  bytes32                         // fixed rate payer
72      32      party_b_id                  bytes32                         // floating rate payer
104     8       notional                    uint64, big-endian              // in termination_currency minor units
112     8       fixed_rate                  uint64, big-endian              // bps × 100, e.g. 350 = 3.50%
120     8       floating_spread             uint64, big-endian              // bps × 100, added to reference rate
128     1       floating_reference          byte                            // see RateReference enum
129     1       payment_frequency           byte                            // see Frequency enum
130     1       day_count_convention        byte                            // see DayCount enum
131     1       business_day_convention     byte                            // see BusinessDay enum
132     1       calculation_agent           byte                            // 0 = party_a, 1 = party_b, 2 = oracle
133     1       roll_convention             byte                            // see RollConvention enum
134     2       reserved                    bytes (zero-filled)
136     8       effective_date              uint64, big-endian              // Unix timestamp
144     8       maturity_date               uint64, big-endian              // Unix timestamp
152     8       next_payment_date           uint64, big-endian              // next scheduled payment
160     8       last_payment_block          uint64, big-endian              // block of last payment
168     8       fixed_amount_due            uint64, big-endian              // signed: party_a pays if > 0
176     8       floating_amount_due         uint64, big-endian              // signed: party_b pays if > 0
184     1       status                      byte                            // see ConfirmationStatus enum
185     1       flags                       byte
186     6       reserved                    bytes (zero-filled)
192     64      trade_reference_uri         padded bytes64, UTF-8           // link to term sheet
256     32      extended_state_digest             bytes32                         // blake2b(encode(confirm_extended))
```

Total: 288 bytes.

**floating_reference** values:

```
SOFR       = 0x00  // Secured Overnight Financing Rate (USD)
EURIBOR    = 0x01  // Euro Interbank Offered Rate (EUR)
SONIA      = 0x02  // Sterling Overnight Index Average (GBP)
TONAR      = 0x03  // Tokyo Overnight Average Rate (JPY)
SARON      = 0x04  // Swiss Average Rate Overnight (CHF)
CORRA      = 0x05  // Canadian Overnight Repo Rate Average (CAD)
AONIA      = 0x06  // Australian Overnight Index Average (AUD)
ESTR       = 0x07  // Euro Short-Term Rate (EUR, €STR)
CUSTOM     = 0xFF  // custom reference defined in trade_reference_uri
```

**payment_frequency** values:

```
DAILY        = 0x00
WEEKLY       = 0x01
BIWEEKLY     = 0x02
MONTHLY      = 0x03
QUARTERLY    = 0x04
SEMIANNUALLY = 0x05
ANNUALLY     = 0x06
AT_MATURITY  = 0x07
```

**day_count_convention** values:

```
ACT_360    = 0x00  // Actual/360
ACT_365    = 0x01  // Actual/365 Fixed
ACT_ACT    = 0x02  // Actual/Actual (ICMA or ISDA)
THIRTY_360 = 0x03  // 30/360 (US or European)
THIRTY_E360= 0x04  // 30E/360
```

**business_day_convention** values:

```
FOLLOWING        = 0x00
MODIFIED_FOLLOWING = 0x01
PRECEDING        = 0x02
MODIFIED_PRECEDING = 0x03
```

**roll_convention** values:

```
ROLL_1  = 0x01   // 1st of month
ROLL_15 = 0x0F   // 15th
ROLL_IMM = 0x10  // IMM dates (3rd Wed of Mar/Jun/Sep/Dec)
ROLL_EOM = 0x1F  // End of month
```

**status** values:

```
ACTIVE           = 0x00  // trade is live, accruing
MATURED          = 0x01  // reached maturity, final payment made
EARLY_TERMINATED = 0x02  // terminated via Close-Out
DEFAULTED        = 0x03  // one party in default, pending Close-Out
```

**flags** bitfield:

```
BIT_FIXED_PAYER       = 0x01  // reserved: party_a always fixed
BIT_COMPOUNDING       = 0x02  // floating rate compounds between payments
BIT_STUB_PERIOD       = 0x04  // first/last period is irregular
BIT_AMORTIZING        = 0x08  // notional amortizes over time
BIT_CANCELLABLE       = 0x10  // one or both parties may cancel
BIT_ORACLE_PRICED     = 0x20  // rate fixing uses OracleRegistry
```

#### Confirmation Extended State

```
offset  size    field                   encoding
0       8       amortization_schedule   uint64, big-endian              // remaining notional if BIT_AMORTIZING
8       8       cancellation_fee        uint64, big-endian              // fee if cancelled before maturity
16      8       cap_rate                uint64, big-endian              // bps × 100, 0 = no cap
24      8       floor_rate              uint64, big-endian              // bps × 100, 0 = no floor
32      32      oracle_registry_id      bytes32                         // 0 = no oracle
64      64      payment_schedule_uri    padded bytes64, UTF-8           // link to detailed schedule
```

Total: 128 bytes.

#### Entrypoints

##### confirm

```
confirm(
    bytes32 master_id,                  // ISDAMaster covenant ID
    uint64  notional,                   // in termination_currency minor units
    uint64  fixed_rate,                 // bps × 100
    uint64  floating_spread,            // bps × 100
    byte    floating_reference,         // SOFR, EURIBOR, SONIA, etc.
    byte    payment_frequency,          // from Frequency enum
    byte    day_count_convention,       // from DayCount enum
    byte    business_day_convention,    // from BusinessDay enum
    byte    calculation_agent,          // 0 = party_a, 1 = party_b, 2 = oracle
    byte    roll_convention,
    uint64  effective_date,             // Unix timestamp
    uint64  maturity_date,              // Unix timestamp
    uint64  cap_rate,                   // bps × 100, 0 = no cap
    uint64  floor_rate,                 // bps × 100, 0 = no floor
    uint8   flags,                      // COMPOUNDING | STUB_PERIOD | AMORTIZING | etc.
    bytes   trade_reference_uri,        // link to term sheet
    sig[] sigs                  // both parties must sign
)
```

Creates a new confirmation under an existing master. Rules:

1. `master_id` must reference a deployed ISDAMaster with BIT_TERMINATED clear.
2. `effective_date < maturity_date`. `effective_date` may be in the future (forward-starting swap).
3. Caller must be `party_a_id` of the master (fixed rate payer). Counterparty is `party_b_id` (floating rate payer). This mapping is conventional: party_a always pays fixed, party_b always pays floating.
4. `signatures` must contain valid signatures from both parties.
5. `confirmation_id` is auto-assigned: `next_id++` stored in the master's extended state.
6. `notional > 0`.
7. `floating_reference` must be a valid RateReference value.
8. If `calculation_agent == 2` (oracle), the master must have an OracleRegistry configured. The BIT_ORACLE_PRICED flag is set.
9. If `cap_rate > 0` and `floor_rate > 0`, then `floor_rate < cap_rate`.
10. On success: produces confirmation UTXO with status = ACTIVE, `next_payment_date = effective_date + first_period`, `fixed_amount_due = 0`, `floating_amount_due = 0`.

##### make_payment

```
make_payment(
    uint64  floating_rate_observed,     // from oracle, bps × 100 (e.g., 535 = 5.35%)
    Sig     signature                   // calculation agent signature
)
```

Processes a periodic payment. Rules:

1. Confirmation status must be ACTIVE.
2. Caller must be the calculation agent or, if `calculation_agent == 2` (oracle), the signature must verify against the registered oracle operator.
3. `current_timestamp >= next_payment_date` — payment is due or past due.
4. Compute fixed leg: `fixed_amount = notional × (fixed_rate / 1000000) × day_count_fraction` where `day_count_fraction` depends on `day_count_convention`.
5. Compute floating leg: `floating_amount = notional × ((floating_rate_observed + floating_spread) / 1000000) × day_count_fraction`.
6. If BIT_CAP: `floating_rate_observed = min(floating_rate_observed, cap_rate)`.
7. If BIT_FLOOR: `floating_rate_observed = max(floating_rate_observed, floor_rate)`.
8. Record: `fixed_amount_due += fixed_amount`, `floating_amount_due += floating_amount`.
9. If BIT_COMPOUNDING: unpaid amounts compound at the floating reference rate.
10. If `current_timestamp >= maturity_date`: status transitions to MATURED, trigger final netting (see ISDANetting).

**Day count fraction computation**:

```
ACT_360:    days_in_period / 360
ACT_365:    days_in_period / 365
ACT_ACT:    days_in_accrual_period_in_leap_year / 366 + days_in_accrual_period_in_non_leap_year / 365
THIRTY_360: (360*(Y2-Y1) + 30*(M2-M1-1) + max(0, 30-D1) + min(30, D2)) / 360
THIRTY_E360: (360*(Y2-Y1) + 30*(M2-M1-1) + max(0, 30-D1) + min(30, D2)) / 360 (with Feb always 30)
```

##### early_terminate

```
early_terminate(
    sig[] sigs                  // both parties must sign (mutual) or Close-Out triggered
)
```

Mutually agrees to terminate before maturity. Rules:

1. Both parties must sign OR an effective Close-Out trigger authorizes unilateral termination.
2. If mutual: fixed and floating amounts due are computed pro-rata to the termination date (accrued but unpaid).
3. Status set to EARLY_TERMINATED.
4. Any outstanding payment obligations are settled via ISDANetting.
5. If BIT_CANCELLABLE and only one party signs: `cancellation_fee` is added to the canceling party's obligation.

### 3. ISDANetting

Implements Section 2(c) of the ISDA Master Agreement. All obligations between the same parties, in the same currency, maturing on the same date, are netted into a single payment. This eliminates gross settlement — instead of two parties each paying the other, only the net difference moves.

#### State Layout

```
offset  size    field                   encoding
0       32      master_id               bytes32                         // ISDAMaster covenant ID
32      32      party_a_id              bytes32
64      32      party_b_id              bytes32
96      1       netting_currency        byte                            // see Currency enum
97      1       flags                   byte
98      6       reserved                bytes (zero-filled)
104     8       netting_date            uint64, big-endian              // Unix timestamp
112     8       party_a_gross_obligation uint64, big-endian              // total party_a owes (positive)
120     8       party_b_gross_obligation uint64, big-endian              // total party_b owes (positive)
128     8       net_amount              uint64, big-endian              // positive = party_a pays party_b
136     8       net_payer               uint8                           // 0 = party_a, 1 = party_b
137     8       settled_at_block        uint64, big-endian              // 0 = not yet settled
145     1       status                  byte                            // see NettingStatus enum
146     62      reserved                bytes (zero-filled)
208     64      confirmation_ids_uri    padded bytes64, UTF-8           // link to list of confirmation IDs
272     32      extended_state_digest         bytes32
```

Total: 304 bytes.

**flags** bitfield:

```
BIT_SETTLED                = 0x01  // net payment completed
BIT_DISPUTED               = 0x02  // one party disputes the net amount
BIT_PARTIAL_SETTLEMENT     = 0x04  // only some confirmations netted
BIT_CLOSE_OUT_NETTING      = 0x08  // this netting is from a Close-Out event
```

**status** values:

```
OPEN       = 0x00  // netting set open, obligations accumulating
CALCULATED = 0x01  // net amount computed, awaiting payment
SETTLED    = 0x02  // payment completed
DISPUTED   = 0x03  // net amount challenged
```

#### Netting Math

The core ISDA netting formula (Section 2(c)):

```
Let C = {c₁, c₂, ..., cₙ} be the set of confirmations under master M
  where for each cᵢ:
    - cᵢ.currency == netting_currency        (same currency)
    - cᵢ.maturity_date >= netting_date       (not yet matured past netting date)
    - cᵢ.status == ACTIVE or DEFAULTED       (not already settled)

party_a_gross_obligation = Σ(fixed_amount_dueᵢ + default_compensation_aᵢ)
party_b_gross_obligation = Σ(floating_amount_dueᵢ + default_compensation_bᵢ)

net_amount = |party_a_gross_obligation - party_b_gross_obligation|

if party_a_gross_obligation > party_b_gross_obligation:
    net_payer = 0 (party_a pays party_b)
elif party_b_gross_obligation > party_a_gross_obligation:
    net_payer = 1 (party_b pays party_a)
else:
    net_amount = 0 (square — no payment)
```

**Currency constraints**:

1. All confirmations in a netting set MUST have the same `termination_currency` as the master.
2. Cross-currency swaps are NOT netted together. A EUR/USD cross-currency swap and a plain USD swap would go into separate netting sets.
3. The netting currency is the master's `termination_currency`. Payments are denominated in that currency's covenant token.

**Compounding on unpaid net amounts**:

If `settled_at_block == 0` and `status == CALCULATED` for more than one payment period, the unpaid net amount compounds at the default interest rate specified in the master agreement (or the floating reference rate if not specified).

#### Entrypoints

##### add_obligation

```
add_obligation(
    bytes32 confirmation_id,            // confirmation to add to netting set
    Sig     signature                   // calculation agent or party signature
)
```

Adds a confirmation's obligations to the netting set. Rules:

1. `confirmation_id` must reference an ACTIVE or DEFAULTED confirmation under this master.
2. The confirmation's currency must match `netting_currency`.
3. The confirmation must not already be in a settled netting set (no double-counting).
4. Caller must be the confirmation's calculation agent or either party.
5. `party_a_gross_obligation += confirmation.fixed_amount_due`.
6. `party_b_gross_obligation += confirmation.floating_amount_due`.
7. Confirmation's `fixed_amount_due` and `floating_amount_due` are cleared (zeroed) to prevent double-counting.

##### settle

```
settle(
    Sig     signature                   // net payer's signature
)
```

Computes the net amount and processes payment. Rules:

1. Netting set must have at least one confirmation added (status = OPEN).
2. Compute net amount per the formula above.
3. If `net_amount == 0`: status = SETTLED immediately (square — no payment flows).
4. If `net_amount > 0`: status = CALCULATED, `net_payer` set.
5. Caller must be `net_payer`. Signature authorizes the payment.
6. On payment: `settled_at_block = current_block`, status = SETTLED.
7. A CommerceFeeCovenant (KCC-0010) fee is deducted from the payment amount if configured (2% protocol fee).
8. On BIT_CLOSE_OUT_NETTING: the settle call is authorized by the Close-Out covenant, not by the party. The party signature requirement is waived — Close-Out settlement is mandatory.

### 4. ISDACloseOut

Implements Section 6 of the ISDA Master Agreement. When an event of default or termination event occurs and is not cured, the non-defaulting party (or both parties for termination events) calculates the early termination amount and settles it. Two methods are supported: Market Quotation and Loss.

#### State Layout

```
offset  size    field                   encoding
0       32      master_id               bytes32                         // ISDAMaster covenant ID
32      32      confirming_party_id     bytes32                         // party that triggered
64      32      calculating_party_id    bytes32                         // non-defaulting party (or both)
96      1       close_out_method        byte                            // 0 = Market Quotation, 1 = Loss
97      1       status                  byte                            // see CloseOutStatus enum
98      1       flags                   byte
99      1       reserved                bytes
100     8       triggered_at_block      uint64, big-endian
108     8       calculated_at_block     uint64, big-endian              // 0 = not yet calculated
116     8       settled_at_block        uint64, big-endian              // 0 = not yet settled
124     8       close_out_amount        uint64, big-endian              // signed: positive = confirming_party pays
132     8       unpaid_amounts          uint64, big-endian              // accrued but unpaid before termination
140     8       settlement_amount       uint64, big-endian              // close_out_amount + unpaid_amounts
148     8       dispute_deadline_block  uint64, big-endian              // block by which dispute must be filed
156     1       event_type              byte                            // EventType that triggered close-out
157     1       determining_party       uint8                           // 0 = party_a, 1 = party_b
158     66      reserved                bytes (zero-filled)
224     64      calculation_report_uri  padded bytes64, UTF-8           // link to detailed calculation
288     32      extended_state_digest         bytes32
```

Total: 320 bytes.

**close_out_method** values:

```
MARKET_QUOTATION = 0x00  // obtain market quotes from reference market-makers
LOSS             = 0x01  // calculate loss of bargain (no active market)
```

**status** values:

```
TRIGGERED   = 0x00  // close-out triggered, awaiting calculation
CALCULATED  = 0x01  // amount calculated by determining party
DISPUTED    = 0x02  // counterparty disputes the calculation
SETTLED     = 0x03  // payment completed
CANCELLED   = 0x04  // close-out cancelled (event cured, both agree)
```

**flags** bitfield:

```
BIT_DEFAULT_CLOSE_OUT   = 0x01  // triggered by event of default
BIT_TERMINATION_CLOSE_OUT = 0x02  // triggered by termination event
BIT_AUTOMATIC_EARLY      = 0x04  // AET applied (bankruptcy)
BIT_FORCE_SETTLE         = 0x08  // settlement enforced without dispute period
```

#### Close-Out Calculation Methods

##### Method A: Market Quotation

The determining party obtains firm quotations from 3+ reference market-makers for replacement transactions. The close-out amount is the average (or best) of these quotations.

```
For each confirmation c in the terminated set:
    replacement_value(c) = PV(replacement_trade) - PV(original_trade)

close_out_amount = Σ replacement_value(c) across all confirmations
```

Where PV is computed using a zero-coupon curve derived from the floating reference rate (SOFR, EURIBOR, etc.) obtained from OracleRegistry attestations.

```
PV(CF, t) = CF / (1 + r × t/365)    // simplified discounting
```

If fewer than 3 quotes are obtainable, the determining party must switch to Loss method.

##### Method B: Loss

The determining party calculates the loss of bargain — the economic equivalent of the terminated transactions. This is used when no active market exists or Market Quotation fails.

```
close_out_amount = Σ (PV(future_cashflows(c)) - PV(hedge_value(c)) + funding_cost(c))
```

Where:
- `future_cashflows(c)` = all remaining payments from termination date to maturity
- `hedge_value(c)` = cost of unwinding any related hedges
- `funding_cost(c)` = cost of funding the replacement position

The determining party must publish `calculation_report_uri` with detailed methodology.

#### Entrypoints

##### trigger

```
trigger(
    uint64  event_id,                   // ISDAMaster event that triggered close-out
    byte    close_out_method,           // MARKET_QUOTATION or LOSS
    Sig     signature                   // non-defaulting party's signature
)
```

Initiates close-out. Rules:

1. `event_id` must reference an event in the ISDAMaster with status = EFFECTIVE (not cured).
2. Caller must be the non-defaulting party. If the event is a Termination Event (not an Event of Default), either party may call.
3. For events of default: BIT_DEFAULT_CLOSE_OUT is set. `determining_party` = caller.
4. For termination events: BIT_TERMINATION_CLOSE_OUT is set. Either party may be determining party.
5. `triggered_at_block = current_block`.
6. All active confirmations under the master are flagged for close-out.
7. If BIT_AUTOMATIC_EARLY is set on the master and event_type == BANKRUPTCY: close-out is automatic (no signature required), BIT_FORCE_SETTLE is set.
8. `dispute_deadline_block = current_block + DISPUTE_WINDOW_BLOCKS` where `DISPUTE_WINDOW_BLOCKS` = 144 (approximately 24 hours at 1 block/sec).

##### calculate

```
calculate(
    bytes32 confirmation_id,            // reservation: phased calculation per confirmation
    uint64  replacement_quote_1,        // firm quote from market-maker 1 (bps × 100)
    uint64  replacement_quote_2,
    uint64  replacement_quote_3,
    uint64  funding_cost,               // cost of funding or hedge unwinding
    bytes   calculation_report_uri,     // link to detailed methodology
    Sig     signature                   // determining party's signature
)
```

Computes the close-out amount. Rules:

1. Close-out status must be TRIGGERED.
2. Caller must be the `determining_party`.
3. For Market Quotation: at least 3 replacement quotes must be provided. Each is a signed attestation from a registered market-maker (verified via OracleRegistry or ConsensusRecord).
4. `close_out_amount` = average of replacement quotes minus PV(original trade) summed across all confirmations.
5. For Loss: `funding_cost` and `calculation_report_uri` are required. The report must detail the methodology, discount curve, and hedge unwind costs.
6. `unpaid_amounts` = sum of all accrued but unpaid payments across all confirmations at the termination date.
7. `settlement_amount = close_out_amount + unpaid_amounts`.
8. If `settlement_amount > 0`: the defaulting party (or the party that triggered the termination event) pays the determining party.
9. Status set to CALCULATED, `calculated_at_block = current_block`.
10. Payment direction: If BIT_DEFAULT_CLOSE_OUT, the defaulting party pays. If BIT_TERMINATION_CLOSE_OUT, the payment direction follows the net sign of `settlement_amount`.

##### settle

```
settle(
    Sig     signature                   // paying party's signature
)
```

Processes the settlement payment. Rules:

1. Status must be CALCULATED.
2. If `dispute_deadline_block > current_block` and BIT_FORCE_SETTLE is not set: settlement may be blocked by a dispute. If status = DISPUTED, fail.
3. `settlement_amount` is transferred from the paying party to the receiving party via the netting mechanism (ISDANetting).
4. On success: status = SETTLED, `settled_at_block = current_block`.
5. A CommerceFeeCovenant fee is deducted if configured.

### 5. ISDACollateral / CSA

The Credit Support Annex. Governs the posting, holding, and return of collateral between the parties. Implements independent amounts, thresholds, minimum transfer amounts, haircuts, and substitution mechanics. Margin calls are enforced automatically when exposure crosses the threshold.

#### State Layout

```
offset  size    field                   encoding
0       32      master_id               bytes32                         // ISDAMaster covenant ID
32      32      party_a_id              bytes32
64      32      party_b_id              bytes32
96      8       independent_amount_a    uint64, big-endian              // IA posted by party_a
104     8       independent_amount_b    uint64, big-endian              // IA posted by party_b
112     8       threshold_a             uint64, big-endian              // party_a's unsecured threshold
120     8       threshold_b             uint64, big-endian              // party_b's unsecured threshold
128     8       minimum_transfer_amount uint64, big-endian              // MTA — minimum transfer size
136     8       total_collateral_a      uint64, big-endian              // total collateral posted by party_a
144     8       total_collateral_b      uint64, big-endian              // total collateral posted by party_b
152     8       exposure_a_to_b         uint64, big-endian              // mark-to-market exposure
160     8       exposure_b_to_a         uint64, big-endian              // mark-to-market exposure
168     2       haircut_cash_bps        uint16, big-endian              // haircut on cash collateral
170     2       haircut_noncash_bps     uint16, big-endian              // haircut on non-cash collateral
172     1       flags                   byte
173     1       margin_call_status      byte                            // see MarginCallStatus enum
174     1       valuation_agent         byte                            // 0 = party_a, 1 = party_b, 2 = third party
175     1       return_rounding         byte                            // 0 = round down, 1 = round up
176     8       last_margin_call_block  uint64, big-endian
184     8       next_valuation_block    uint64, big-endian
192     64      eligible_collateral_uri padded bytes64, UTF-8           // link to eligible collateral schedule
256     32      extended_state_digest         bytes32
```

Total: 288 bytes.

**flags** bitfield:

```
BIT_MARGIN_CALL_PENDING    = 0x01  // outstanding margin call
BIT_RETURN_PENDING         = 0x02  // excess collateral awaiting return
BIT_DISPUTE_PENDING        = 0x04  // valuation dispute in progress
BIT_SUBSTITUTION_ALLOWED   = 0x08  // collateral substitution permitted
BIT_INDEPENDENT_AMOUNT_SEGREGATED = 0x10  // IA held in segregated account
```

**margin_call_status** values:

```
NONE           = 0x00  // no margin call active
CALLED         = 0x01  // margin call issued, awaiting posting
PARTIALLY_MET  = 0x02  // partial posting received
MET            = 0x03  // margin call fully satisfied
DISPUTED       = 0x04  // margin call disputed
```

#### Collateral Mechanics

##### Exposure Calculation

For each party, exposure is the mark-to-market value of all outstanding confirmations:

```
exposure_a_to_b = Σ PV(remaining_cashflows_a_to_b) for all confirmations
exposure_b_to_a = Σ PV(remaining_cashflows_b_to_a) for all confirmations

net_exposure_a = max(0, exposure_b_to_a - exposure_a_to_b)
net_exposure_b = max(0, exposure_a_to_b - exposure_b_to_a)
```

##### Credit Support Amount

The amount of collateral that should be posted:

```
credit_support_amount(party) =
    max(0, net_exposure(party) + independent_amount(party) - threshold(party))

delivery_amount(party) =
    credit_support_amount(party) - total_collateral(party)

return_amount(party) =
    total_collateral(party) - credit_support_amount(party)
```

##### Margin Call Trigger

A margin call is issued when:

```
|delivery_amount(party)| >= minimum_transfer_amount
```

If `delivery_amount(party) > 0`: the party must post additional collateral.

If `return_amount(party) > 0 AND return_amount(party) >= minimum_transfer_amount`: excess collateral must be returned.

The `minimum_transfer_amount` prevents trivial calls on small exposure changes. Typical values: $500,000 for large dealers, $10,000-$50,000 for smaller counterparties.

##### Haircut Rates

Collateral value is discounted by a haircut before being credited:

```
eligible_value = market_value × (1 - haircut_bps / 10000)

haircut_bps:
  cash:  200 (2.00%)     — G7 government securities: 50-200 bps
  non-cash (low risk): 500-800 (5-8%)   — investment-grade corporate bonds
  non-cash (medium):   800-1200 (8-12%) — high-yield bonds, equities
  non-cash (high risk): 1200-1500 (12-15%) — convertible bonds, structured notes
```

Minimum haircut: 0.5%. Maximum haircut: 50%. These bounds prevent both under-collateralization and excessive discounting.

##### Concentration Limits

Per ISDA best practices, concentration limits apply to non-cash collateral:

```
max_per_issuer    = 10% of total collateral  // single issuer cap
max_per_currency  = no limit (if same as termination currency)
max_per_asset_class = 50%                     // asset class diversification
```

These are verified off-chain via the eligibility schedule referenced in `eligible_collateral_uri`.

##### Substitution Mechanics

When BIT_SUBSTITUTION_ALLOWED is set, a party may substitute one form of eligible collateral for another:

```
substitution proceeds only if:
  new_collateral_value >= old_collateral_value × (1 + SUBSTITUTION_BUFFER)
  where SUBSTITUTION_BUFFER = 0.02 (2% cushion)
```

The 2% buffer prevents value erosion during substitution. Both the old and new collateral must be on the eligible collateral schedule.

#### Collateral Extended State

```
offset  size    field                   encoding
0       8       collateral_call_id      uint64, big-endian              // monotonic counter
8       144*N   positions               CollateralPosition[N]
```

**CollateralPosition** record (144 bytes):

```
offset  size    field                   encoding
0       32      asset_id                bytes32                         // token contract or covenant ID
32      8       quantity                uint64, big-endian
40      8       market_value            uint64, big-endian              // at time of posting
48      8       haircut_bps             uint16, big-endian
50      8       posted_at_block         uint64, big-endian
58      1       posting_party           uint8                           // 0 = party_a, 1 = party_b
59      1       position_status         byte                            // 0 = active, 1 = returned, 2 = substituted
60      4       reserved                bytes
64      64      asset_description_uri   padded bytes64, UTF-8
128     16      reserved                bytes
```

#### Entrypoints

##### post

```
post(
    bytes32 asset_id,                   // token contract or covenant ID of collateral
    uint64  quantity,                    // amount of asset posted
    uint64  market_value,               // current market value (verified via oracle)
    Sig     signature                   // posting party's signature
)
```

Posts collateral to satisfy a margin call or increase coverage. Rules:

1. Caller must be `party_a_id` or `party_b_id`.
2. `asset_id` must be on the eligible collateral schedule (verified via `eligible_collateral_uri`).
3. `market_value` must be verified via OracleRegistry attestation (KCC-0017) dated within `max_attestation_age` blocks (default: 10).
4. Eligible value: `credit_value = market_value × (1 - haircut_bps / 10000)`.
5. `total_collateral_party += credit_value`.
6. A new CollateralPosition is recorded.
7. If a margin call is active (BIT_MARGIN_CALL_PENDING): after posting, recalculate `delivery_amount`. If `delivery_amount < minimum_transfer_amount`, clear the margin call (status = MET).
8. Concentration limits are checked: the posting must not cause any single issuer to exceed `max_per_issuer` of total collateral.

##### margin_call

```
margin_call(
    uint64  exposure_update,             // updated MTM exposure (from oracle or calculation agent)
    Sig     signature                    // valuation agent's signature
)
```

Issues a margin call when exposure has changed. Rules:

1. Caller must be the `valuation_agent`.
2. `exposure_update` must be a valid OracleRegistry attestation or calculation agent signature.
3. Update `exposure_a_to_b` and `exposure_b_to_a` based on current mark-to-market.
4. Compute `delivery_amount` for each party.
5. If `|delivery_amount(party)| >= minimum_transfer_amount` for either party: BIT_MARGIN_CALL_PENDING is set, `margin_call_status = CALLED`.
6. `last_margin_call_block = current_block`.
7. If `delivery_amount < 0` (excess collateral) for a party AND `|delivery_amount| >= minimum_transfer_amount`: BIT_RETURN_PENDING is also set.

Valuation frequency: at minimum daily (`next_valuation_block = current_block + DAILY_BLOCKS` where `DAILY_BLOCKS = 86,400` at 1 block/sec).

##### return_excess

```
return_excess(
    uint64  amount,                     // amount of collateral to return
    Sig     signature                   // receiving party's signature
)
```

Returns excess collateral to the entitled party. Rules:

1. BIT_RETURN_PENDING must be set.
2. Caller must be the party holding the excess (the party that posted).
3. `amount <= return_amount(party)` where `return_amount = total_collateral(party) - credit_support_amount(party)`.
4. `amount >= minimum_transfer_amount` unless returning all remaining collateral (close-out scenario).
5. On return: `total_collateral_party -= amount`.
6. The corresponding CollateralPositions are marked as `returned`, starting from the oldest positions (FIFO return order).
7. If `return_amount(party) < minimum_transfer_amount` after return: clear BIT_RETURN_PENDING.

##### substitute

```
substitute(
    bytes32 old_asset_id,               // collateral being withdrawn
    uint64  old_quantity,
    bytes32 new_asset_id,               // replacement collateral
    uint64  new_quantity,
    uint64  new_market_value,           // verified via oracle
    Sig     signature                   // substituting party's signature
)
```

Substitutes one form of collateral for another. Rules:

1. BIT_SUBSTITUTION_ALLOWED must be set.
2. Both `old_asset_id` and `new_asset_id` must be on the eligible collateral schedule.
3. `old_asset_id` must be currently posted by the caller with at least `old_quantity` in ACTIVE positions.
4. `new_market_value` verified via OracleRegistry attestation.
5. Substitution value check: `new_eligible_value >= old_eligible_value × (1 + SUBSTITUTION_BUFFER)` where `new_eligible_value = new_market_value × (1 - haircut(new_asset) / 10000)` and `old_eligible_value = old_market_value × (1 - haircut(old_asset) / 10000)`.
6. If the substitution would cause `total_collateral_party < credit_support_amount(party) + minimum_transfer_amount`: fail — insufficient coverage.
7. On success: old position marked as `substituted`, new position created.
8. `total_collateral_party` is updated to reflect the new eligible value.

##### close

```
close(
    sig[] sigs                  // both parties OR Close-Out trigger
)
```

Terminates the CSA and returns all remaining collateral. Rules:

1. Both parties must sign, OR if BIT_DEFAULT_CLOSE_OUT is set on an ISDACloseOut referencing this master, the Close-Out covenant authorizes closure.
2. All outstanding CollateralPositions are marked as `returned`.
3. Collateral is returned to the posting party. If Close-Out: collateral may be netted against the close-out settlement amount.
4. `total_collateral_a = 0`, `total_collateral_b = 0`.
5. The CSA covenant state transitions to terminal (no further entrypoints permitted).

### Descriptors

Each sub-convention must publish a descriptor per KCC-0016:

```
ISDAMasterDescriptor {
    prefix: bytes              // covenant script prefix
    suffix: bytes              // covenant script suffix
    party_a_id: bytes32        // fixed at deployment
    party_b_id: bytes32        // fixed at deployment
    governing_law: enum        // ENGLISH_LAW | NEW_YORK_LAW
    termination_currency: enum // USD | EUR | GBP | JPY | CHF | CAD | AUD
    cure_period_blocks: uint8
}

ISDAConfirmationDescriptor {
    prefix: bytes
    suffix: bytes
    master_id: bytes32         // parent ISDAMaster
    confirmation_id: uint64
    notional: uint64
    fixed_rate: uint64
    floating_reference: enum   // SOFR | EURIBOR | SONIA | ...
}

ISDANettingDescriptor {
    prefix: bytes
    suffix: bytes
    master_id: bytes32
    netting_currency: enum
    netting_date: uint64
}

ISDACloseOutDescriptor {
    prefix: bytes
    suffix: bytes
    master_id: bytes32
    close_out_method: enum     // MARKET_QUOTATION | LOSS
    triggered_at_block: uint64
}

ISDACollateralDescriptor {
    prefix: bytes
    suffix: bytes
    master_id: bytes32
    independent_amount_a: uint64
    independent_amount_b: uint64
    threshold_a: uint64
    threshold_b: uint64
    minimum_transfer_amount: uint64
}
```

## Encoding

These conventions specify the semantic interface and state layouts for ISDA derivatives infrastructure. They do NOT define a token standard — they are conventions that compose WITH token standards.

For byte-level encoding of covenant state, argument codecs, and entrypoint dispatch tags, see KCC-0001 (IzioDev). For the transfer leader/delegator pattern, see KCC-0020.

For the ABI format enabling tooling auto-discovery, see KCC-0016 (Covenant ABI). For oracle attestation format consumed by ISDAConfirmation (rate fixing) and ISDACollateral (asset valuation), see KCC-0017.

Payment settlement uses KCC-0008 (Multi-Token Standard) tokens denominated in the master's `termination_currency`.

## KCC-0020 Alignment

These conventions do NOT use KCC-0020's transfer leader/delegator pattern. ISDA conventions are state-machine covenants, not token covenants. Each entrypoint is a standalone state transition invoked by an authorized party — there is no positional witness array, no Borrowed Receive pattern, and no sum-preservation rule across inputs and outputs.

Where KCC-0020 patterns are NOT applicable:

- **Transfer**: ISDA covenants do not transfer fungible units between holders. They record obligations, compute net amounts, and trigger settlement — but the settlement itself is a payment in a KCC-0008 token, not an ISDA covenant state transition.
- **Witness semantics**: Authorization is per-entrypoint via explicit `Sig[]` parameters, not positional witnesses.
- **Extended state**: ISDA conventions use `extended_state_digest` to commit to convention-specific data, but the digest computation follows KCC-0020's pattern: `blake2b(encode(extended_state))`.

Where KCC-0020 patterns ARE adopted:

- **Descriptor**: prefix/suffix covenant script bytes for template identification (same pattern, different content).
- **Extended digest**: blake2b commitment over extended state, preserving opacity for standard tooling.

## ### Fee Bridge

ISDA conventions may route protocol fees through KCC-0010 (Fee-on-Transfer Token). When a confirmation or netting settlement produces a payment, the fee is deducted via the token's covenant-enforced fee schedule — no separate fee covenant is required. The fee recipient is configured in the KCC-0010 token's `fee_schedule` at deployment.

### Composability

ISDA conventions compose with the full Vida covenant ecosystem:

| Composes With | Used By | Purpose |
|---|---|---|
| **ConsensusSignal** (KCC-0019) | ISDAMaster | Track events of default — `condition_met` on payment, `breach` on failure to pay, `remedied` on cure |
| **ConsensusRecord** (KCC-0019) | ISDACloseOut | Multi-party attestation of replacement quotes for Market Quotation close-out |
| **MultiPartyExecute** (KCC-0019) | ISDAMaster | Sequential multi-signature execution for multilateral master agreements |
| **OracleRegistry** (KCC-0018) | ISDAConfirmation, ISDACollateral | Rate fixing data (SOFR, EURIBOR, SONIA) via KCC-0017 attestations; collateral asset valuation |
| **CommerceFeeCovenant** (KCC-0010) | ISDANetting, ISDACloseOut | 2% protocol fee deducted from all settlement payments |
| **KCC-0008** (Multi-Token) | ISDANetting, ISDACloseOut, ISDACollateral | Payment settlement in termination currency tokens |

### Composition Walkthrough: ISDA Interest Rate Swap Lifecycle

```
1. MultiPartyExecute → ISDAMaster.execute
   Both parties sign the master agreement.

2. ISDAConfirmation.confirm
   Records a 5-year USD SOFR swap: notional $10M, fixed 3.50%, quarterly payments.

3. OracleRegistry → ISDAConfirmation.make_payment
   Each quarter: SOFR rate observed via oracle attestation.
   Fixed leg: $10M × 3.50% × 90/360 = $87,500.
   Floating leg: $10M × SOFR × 90/360.
   Net: fixed - floating.

4. ISDANetting.add_obligation + settle
   Multiple confirmations netted into single payment.
   CommerceFeeCovenant deducts 2% fee.

5. ISDACollateral.margin_call
   Daily MTM: if exposure > threshold, margin call issued.
   Collateral posted via ISDACollateral.post.

6. ISDAMaster.declare_default → ISDACloseOut.trigger → ISDACloseOut.calculate
   Counterparty fails to pay. Event declared. Close-out triggered.
   Non-defaulting party calculates termination amount.
   Settlement via ISDACloseOut.settle.

7. ISDACollateral.close
   CSA terminated. Collateral returned or netted against settlement.
```

## Rules

### ISDAMaster Rules

1. `party_a_id` bytes < `party_b_id` bytes when interpreted as big-endian uint256 — ordering is deterministic and enforced at deployment.
2. Only ENGLISH_LAW (0x00) or NEW_YORK_LAW (0x01) are valid governing law values.
3. The same pair of parties may have at most one active ISDAMaster (BIT_TERMINATED = 0).
4. An event of default declared by a party cannot be cured by the counterparty — only the declaring party may cure.
5. A default not cured within `cure_period_blocks` automatically transitions to EFFECTIVE.
6. BIT_AUTOMATIC_EARLY + BANKRUPTCY triggers immediate automatic close-out with BIT_FORCE_SETTLE.
7. A terminated master cannot accept new confirmations.

### ISDAConfirmation Rules

8. Every confirmation MUST reference a deployed, non-terminated ISDAMaster.
9. `effective_date < maturity_date`. Payment frequency must allow at least one full period.
10. `notional > 0`.
11. If `calculation_agent == 2` (oracle), an OracleRegistry must be configured and BIT_ORACLE_PRICED is set.
12. `floating_rate_observed` for make_payment must be a valid KCC-0017 attestation within the max attestation age.
13. If BIT_CANCELLABLE and terminated early: `cancellation_fee` is added to the canceling party's obligation.

### ISDANetting Rules

14. All confirmations in a netting set MUST use the same `termination_currency` as the master.
15. Cross-currency obligations are NOT netted together — separate netting sets are required per currency.
16. Net amount computed as `|party_a_gross - party_b_gross|`. If zero, no payment flows (square).
17. A confirmation's obligations may only be included in one netting set (no double-counting).
18. BIT_CLOSE_OUT_NETTING settlements are mandatory — the paying party's signature requirement is waived.

### ISDACloseOut Rules

19. Close-Out MUST be triggered by the non-defaulting party (Events of Default) or either party (Termination Events).
20. The determining party MUST be the non-defaulting party for Events of Default.
21. Market Quotation requires ≥ 3 firm quotes from reference market-makers. If unavailable, switch to Loss.
22. The calculation report URI MUST be published before settlement.
23. Settlement may be disputed within `dispute_deadline_block` unless BIT_FORCE_SETTLE is set.

### ISDACollateral / CSA Rules

24. Collateral MUST be returned when `return_amount(party) >= minimum_transfer_amount`.
25. Haircut rates: cash 200 bps (2.0%), non-cash 500-1500 bps (5-15%) per ISDA best practices.
26. Minimum haircut: 50 bps (0.5%). Maximum haircut: 5000 bps (50%).
27. Substitution requires `new_eligible_value >= old_eligible_value × 1.02` (2% buffer).
28. Concentration limits: max 10% per issuer, max 50% per asset class.
29. `margin_call` must be called at minimum daily frequency.
30. Collateral asset values must be verified via OracleRegistry attestation (KCC-0017) within `max_attestation_age` blocks.
31. A margin call is only triggered when `|delivery_amount| >= minimum_transfer_amount`.

## Reference

The 2002 ISDA Master Agreement and 1994 Credit Support Annex (English and New York law versions) are the canonical legal references. This convention implements Sections 2(c) (Netting), 5 (Events of Default and Termination Events), and 6 (Early Termination; Close-Out Netting) of the 2002 ISDA Master Agreement, and the full 1994 ISDA Credit Support Annex (Security Interest — English Law and New York Law versions). The author maintains a conforming SilverScript implementation. This document defines the convention; an implementation demonstrates conformance.

### Related Standards

| Standard | Relationship |
|---|---|
| KCC-0001 (IzioDev) | Byte-level covenant encoding, state/argument codecs, entrypoint dispatch |
| KCC-0008 (Multi-Token) | Settlement token standard for payments in termination currency |
| KCC-0010 (Fee-on-Transfer) | Commerce fee deduction on settlement payments |
| KCC-0016 (Covenant ABI) | Interface discovery — ISDA covenants publish ABIs for tooling |
| KCC-0017 (Oracle Attestation) | Rate fixing data format consumed by ISDAConfirmation and ISDACollateral |
| KCC-0018 (Oracle Registry) | Operator registry for rate fixing and asset valuation |
| KCC-0019 (Legal Signaling) | ConsensusSignal for event tracking, MultiPartyExecute for multilateral masters |
| KCC-0023 (Lending) | LMA lending convention — shares close-out and collateral patterns |
| KCC-0024 (Trade Finance) | UCP600 trade finance — shares payment and settlement patterns |