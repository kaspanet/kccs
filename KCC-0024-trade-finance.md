# KCC-0024: Trade Finance Convention

| Field | Value |
|-------|-------|
| **KCC** | 0024 |
| **Category** | Covenant Convention |
| **Title** | Trade Finance — letters of credit and international delivery terms |
| **Author** | Vida Wallet |
| **Status** | Draft |
| **Created** | 2026-07-24 |
| **Updated** | 2026-07-25 |

## Abstract

Two sub-conventions governing $2T+ in annual global trade finance on Kaspa: **UCP600** (ICC Uniform Customs and Practice for Documentary Credits — letters of credit) and **Incoterms** (ICC International Commercial Terms — delivery responsibilities). UCP600 guarantees payment against compliant document presentation via a bank-issued letter of credit. Incoterms encode who pays freight, insurance, and customs, and at what point risk transfers from seller to buyer. Together with CommerceInvoice and CommerceFeeCovenant, these covenants form a complete trade transaction — from purchase order to payment.

## Motivation

Trade finance is the largest financial market with the least digitization. Letters of credit remain paper-bound: documents are physically couriered, examined by hand, and paid via SWIFT messages that settle days later. Discrepancy rates exceed 50% on first presentation, each requiring manual resolution. Incoterms are referenced in contracts but enforced only through litigation — there is no programmatic mechanism that prevents a seller from shipping CIF and billing the buyer for freight the buyer never agreed to pay.

Kaspa covenants can encode these rules directly. A letter of credit covenant that verifies document hashes and enforces the 5-banking-day examination window replaces back-office document checkers. An Incoterms covenant that hard-codes freight, insurance, and customs obligations per term replaces contract disputes with deterministic execution. Both are needed: UCP600 governs payment; Incoterms govern delivery. Together they replicate the legal infrastructure of international trade in covenant code.

## Specification

### UCP600 — Documentary Credit

The UCP600 sub-convention implements a letter of credit: a bank (issuing_bank) guarantees payment to a beneficiary on presentation of documents that comply with the credit terms. The bank has 5 banking days from presentation to examine documents and either pay or issue a discrepancy notice specifying each defect. Documents are verified by hash, not content inspection — the covenant compares presented document hashes against the required document hashes set at issuance.

#### State Layout

Every UCP600 covenant state consists of the following fields, in this order and encoding:

```
offset  size    field                 encoding
0       32      issuing_bank          bytes32  (bank identity, per KCC-0014)
32      32      beneficiary           bytes32  (party receiving payment)
64      32      applicant             bytes32  (party requesting the LC)
96      8       lc_amount             uint64, big-endian (value in cents)
104     3       currency              bytes3, ISO 4217
107     1       _reserved             byte (padding to 8-byte alignment)
108     8       expiry_block          uint64, big-endian
116     8       issue_block           uint64, big-endian
124     1       status                byte
125     1       flags                 byte
126     2       doc_count             uint16, big-endian (number of required documents)
128     8       presentation_block    uint64, big-endian (block of document presentation)
136     1       presented_count       byte (number of documents actually presented)
137     7       _reserved2            bytes (padding)
144     32*8    document_hashes       bytes32[8] (required document hashes, blake2b)
400     32*8    presented_hashes      bytes32[8] (presented document hashes)
656     2*8     discrepancy_count     uint16, big-endian
658     64*8    discrepancy_notices   DiscrepancyNotice[8]
```

Total: 1170 bytes of covenant state.

**`status`** values:

```
ISSUED        = 0x00  // LC has been issued, awaiting presentation
PRESENTED     = 0x01  // documents presented, awaiting examination
COMPLIANT     = 0x02  // documents examined and found compliant
NON_COMPLIANT = 0x03  // discrepancies identified, notice issued
PAID          = 0x04  // payment has been released to beneficiary
EXPIRED       = 0x05  // LC expired without compliant presentation (terminal)
CANCELLED     = 0x06  // LC cancelled by mutual agreement (terminal)
AMENDED       = 0x07  // LC terms amended (returns to ISSUED)
```

**`flags`** bitfield:

```
BIT_IRREVOCABLE = 0x01  // LC cannot be cancelled or amended without beneficiary consent
BIT_CONFIRMED   = 0x02  // a confirming bank has added its undertaking
BIT_TRANSFERRED = 0x04  // beneficiary has transferred LC rights
BIT_SIGHT       = 0x08  // LC is payable at sight (vs. deferred payment)
```

**`document_hashes`** stores up to 8 blake2b hashes of required documents. Each entry is either a valid hash or 32 zero bytes (indicating no document at that slot). At issuance, the issuing bank commits these hashes to the covenant state. At presentation, the beneficiary submits the plain documents off-chain. The covenant verifies that each presented document, when hashed, matches a required document hash.

**`DiscrepancyNotice`** is a packed struct:

```
offset  size    field
0       2       field_offset  uint16  (offset into covenant state of discrepant field)
2       1       reason_code   byte    (see Discrepancy Codes below)
3       29      description   padded bytes29, UTF-8
```

Total: 32 bytes per notice. Up to 8 notices stored in `discrepancy_notices[]`.

**Discrepancy Codes** (reason_code values):

```
LATE_PRESENTATION    = 0x01  // presented after expiry_block
MISSING_DOCUMENT     = 0x02  // required document not presented
HASH_MISMATCH        = 0x03  // presented doc hash ≠ required doc hash
AMOUNT_MISMATCH      = 0x04  // invoice amount ≠ lc_amount
INCOTERM_MISMATCH    = 0x05  // shipping terms don't match LC
LATE_SHIPMENT        = 0x06  // bill of lading date exceeds latest shipment date
INSURANCE_GAP        = 0x07  // insurance coverage insufficient or missing
PARTIAL_SHIPMENT     = 0x08  // partial shipment where prohibited
TRANSSHIPMENT        = 0x09  // transshipment where prohibited
STALE_DOCUMENT       = 0x0A  // documents presented after 21 days from shipment
DESCRIPTION_GAP      = 0x0B  // goods description inconsistent across documents
SIGNATURE_MISSING    = 0x0C  // required signature absent
ENDORSEMENT_MISSING  = 0x0D  // bill of lading not properly endorsed
```

#### Entrypoints

##### issue

```
issue(
    bytes32 beneficiary,            // party to receive payment
    bytes32 applicant,              // party requesting the LC
    uint64  lc_amount,              // credit amount in cents
    bytes3  currency,               // ISO 4217 currency
    uint64  expiry_block,           // block height when LC expires
    byte    flags,                  // irrevocable, confirmed, sight, etc.
    bytes32[8] document_hashes      // hashes of required documents
)
```

Creates a letter of credit. Caller must be the issuing bank (verified against KCC-0014 identity). Rules:

1. `lc_amount` must be > 0.
2. `expiry_block` must be > current block height.
3. At least one `document_hashes[i]` must be non-zero (at least one document required).
4. `currency` must be a valid ISO 4217 code.
5. `beneficiary` must be a valid KCC-0014 identity.
6. On success, a new UTXO is produced with `status = ISSUED`, `issue_block = current_block`, and all fields populated as specified.

##### present

```
present(
    bytes32[8] presented_hashes     // hashes of documents being presented
)
```

Beneficiary presents documents for examination. Caller must be the `beneficiary`. Rules:

1. `status` must be `ISSUED`.
2. `current_block` must be ≤ `expiry_block` (late presentation fails).
3. Each non-zero `presented_hashes[i]` is copied to `presented_hashes[i]`.
4. `presented_count` is set to the count of non-zero entries.
5. On success, `status` transitions to `PRESENTED` and `presentation_block = current_block`.

##### examine

```
examine()
```

Bank examines presented documents within 5 banking days. Caller must be the `issuing_bank`. Rules:

1. `status` must be `PRESENTED`.
2. `current_block` must be ≤ `presentation_block + 5_banking_days` (approximately 432000 blocks at 1 BPS).
3. Bank performs off-chain document review and determines compliance.
4. This entrypoint does NOT change state — it is a validation gate. The bank must follow with either `pay` or `notice_discrepancy`.
5. If `current_block > presentation_block + 5_banking_days`, the bank is deemed to have accepted the documents. `examine` fails; only `pay` is permitted.

##### pay

```
pay()
```

Bank releases payment to beneficiary on compliant documents. Caller must be the `issuing_bank`. Rules:

1. `status` must be `PRESENTED` or `COMPLIANT`.
2. Every non-zero `document_hashes[i]` must have a matching non-zero entry in `presented_hashes[]`. Exact hash equality is required — no fuzzy matching.
3. `presented_count` must equal `doc_count` (all required documents presented).
4. On success, `status` transitions to `PAID`. The covenant produces a payment output to `beneficiary` for `lc_amount` in `currency`.
5. Payment is atomic: either all documents pass and payment is released, or none do and the state is unchanged.

##### notice_discrepancy

```
notice_discrepancy(
    uint16              discrepancy_count,           // number of discrepancies
    DiscrepancyNotice[] notices                      // one notice per discrepancy
)
```

Bank notifies beneficiary of specific discrepancies per UCP 600 Article 16. Caller must be the `issuing_bank`. Rules:

1. `status` must be `PRESENTED`.
2. `discrepancy_count` must be ≥ 1.
3. Each `notices[i].field_offset` must reference a valid field in the covenant state.
4. Each `notices[i].reason_code` must be a valid discrepancy code.
5. Each `notices[i].description` must be non-empty UTF-8 describing the discrepancy.
6. On success, `status` transitions to `NON_COMPLIANT`. `discrepancy_notices[]` and `discrepancy_count` are written to state.
7. The beneficiary may correct discrepancies and present again (return to `ISSUED` and re-invoke `present`), provided `expiry_block` has not passed.
8. UCP 600 Article 16 requirement: a single generic notice ("documents non-compliant") is insufficient. Each specific discrepancy must be enumerated.

##### amend

```
amend(
    uint64          new_expiry_block,    // 0 = unchanged
    uint64          new_lc_amount,       // 0 = unchanged
    bytes32[8]      new_document_hashes, // zeroed entries = unchanged
    byte            new_flags            // modifies flags if non-zero
)
```

Amends LC terms. Caller is the `applicant`; requires `beneficiary` consent. Rules:

1. `status` must be `ISSUED` or `AMENDED`.
2. If `BIT_IRREVOCABLE` is set, amendment requires a signature from `beneficiary` confirming consent.
3. Non-zero amendment fields overwrite the corresponding state fields.
4. On success, `status` transitions to `AMENDED`, then immediately back to `ISSUED` (amendments are transparent to subsequent presentation). A new `issue_block` is recorded.
5. `expiry_block` (if amended) must be > current block height.

##### cancel

```
cancel()
```

Cancels the LC. Caller depends on context. Rules:

1. If `status == ISSUED` and `BIT_IRREVOCABLE` is NOT set: either `applicant` or `issuing_bank` may cancel.
2. If `status == ISSUED` and `BIT_IRREVOCABLE` IS set: requires `beneficiary` consent signature.
3. If `status == NON_COMPLIANT`: `applicant` may cancel if `beneficiary` has not re-presented within a reasonable window.
4. On success, `status` transitions to `CANCELLED` (terminal state).
5. If `status == EXPIRED`: no action — already terminal.

##### expire

```
expire()
```

Marks LC as expired. Invocable by anyone after `expiry_block`. Rules:

1. `current_block` must be > `expiry_block`.
2. `status` must not be `PAID`, `CANCELLED`, or `EXPIRED`.
3. On success, `status` transitions to `EXPIRED` (terminal state).

#### Document Verification Protocol

Documents are NOT stored on-chain. The covenant stores only blake2b hashes. The verification protocol:

1. **Issuance**: Applicant and issuing bank agree on required documents. Each document is hashed with blake2b. The hashes are stored in `document_hashes[]` in the `issue` entrypoint.
2. **Presentation**: Beneficiary submits documents off-chain to the issuing bank. The bank hashes each document and invokes `present` with the hashes.
3. **Examination**: Bank examines the actual documents against LC terms. The `examine` entrypoint gates the examination window (5 banking days per UCP 600 Article 14(b)).
4. **Compliance**: If hashes match and examination passes, `pay` releases funds. If not, `notice_discrepancy` records each defect.
5. **Off-chain settlement**: The actual document contents (bill of lading, commercial invoice, packing list, certificate of origin, insurance certificate) are exchanged off-chain. The covenant attests that the bank found them compliant (or not) under UCP 600 rules.

### Incoterms — International Commercial Terms

The Incoterms sub-convention encodes delivery responsibilities for international sale of goods. Each term defines: who arranges and pays for carriage (freight), who arranges and pays for insurance, who handles customs clearance (export and import), and the point at which risk transfers from seller to buyer. Four terms are supported: EXW, FOB, CIF, DDP.

#### State Layout

Every Incoterms covenant state consists of the following fields, in this order and encoding:

```
offset  size    field                 encoding
0       1       term                  byte (Incoterm enum)
1       1       status                byte
2       32      seller                bytes32 (seller identity, per KCC-0014)
34      32      buyer                 bytes32 (buyer identity)
66      32      carrier               bytes32 (carrier identity, 0 if not yet assigned)
98      64      port_of_loading       padded bytes64, UTF-8 (UN/LOCODE)
162     64      port_of_discharge     padded bytes64, UTF-8 (UN/LOCODE)
226     8       risk_transfer_block   uint64, big-endian (block at which risk transferred)
234     8       shipment_block        uint64, big-endian (block when goods shipped)
242     8       delivery_block        uint64, big-endian (block when goods delivered)
250     8       lc_amount             uint64, big-endian (invoice value in cents; 0 = not tied to LC)
258     3       currency              bytes3, ISO 4217 (invoice currency)
261     1       freight_prepaid       byte (0x00 = collect, 0x01 = prepaid)
262     1       insurance_required    byte (0x00 = no, 0x01 = yes)
263     1       insurance_bps         byte (coverage as basis points of lc_amount, e.g. 110 = 110%)
264     1       export_clearance_by   byte (0x00 = seller, 0x01 = buyer)
265     1       import_clearance_by   byte (0x00 = seller, 0x01 = buyer)
266     6       _reserved             bytes (padding to 8-byte alignment)
272     32      dispute_digest        bytes32 (blake2b hash of dispute evidence, 0 if none)
304     32      oracles[]             bytes32[8] (resolution oracles for dispute escalation)
```

Total: 560 bytes of covenant state.

**`term`** values (Incoterms 2020):

```
EXW = 0x00  // Ex Works — buyer collects from seller's premises
FOB = 0x01  // Free On Board — seller delivers goods on board vessel at named port
CIF = 0x02  // Cost Insurance Freight — seller pays freight + insurance to named port
DDP = 0x03  // Delivered Duty Paid — seller delivers goods cleared for import at named place
```

**`status`** values:

```
CREATED   = 0x00  // Incoterms term created, awaiting shipment
SHIPPED   = 0x01  // goods loaded/shipped (risk transfers per term rules)
IN_TRANSIT = 0x02 // goods in transit
DELIVERED = 0x03  // goods arrived at discharge point
ACCEPTED  = 0x04  // buyer accepted delivery (terminal success)
DISPUTED  = 0x05  // dispute raised, oracles engaged
RESOLVED  = 0x06  // dispute resolved (terminal)
```

#### Term-Specific Defaults

Each term sets default values for delivery responsibilities. These are written to state at creation and govern subsequent transitions:

| Field | EXW | FOB | CIF | DDP |
|-------|-----|-----|-----|-----|
| freight_prepaid | 0x00 (buyer) | 0x00 (buyer) | 0x01 (seller) | 0x01 (seller) |
| insurance_required | 0x00 | 0x00 | 0x01 | 0x01 |
| insurance_bps (min) | 0 | 0 | 110 | 110 |
| export_clearance_by | 0x01 (buyer) | 0x00 (seller) | 0x00 (seller) | 0x00 (seller) |
| import_clearance_by | 0x01 (buyer) | 0x01 (buyer) | 0x01 (buyer) | 0x00 (seller) |
| risk_transfer_point | buyer collects | on board vessel | on board vessel at load port | at named destination |

#### Entrypoints

##### create

```
create(
    byte    term,                  // Incoterm code (0x00-0x03)
    bytes32 buyer,                 // buyer identity
    bytes64 port_of_loading,       // UN/LOCODE
    bytes64 port_of_discharge,     // UN/LOCODE
    uint64  lc_amount,             // 0 if not tied to LC
    bytes3  currency,              // ISO 4217
    byte    insurance_bps,         // override default (0 = use term default)
    bytes32[8] oracles             // dispute resolution oracles
)
```

Creates an Incoterms delivery contract. Caller must be the `seller`. Rules:

1. `term` must be in range `0x00–0x03`.
2. `buyer` must be a valid KCC-0014 identity.
3. `port_of_loading` and `port_of_discharge` must be valid, non-empty UTF-8 strings (preferably UN/LOCODE).
4. If `insurance_bps` is non-zero and the term requires insurance, it must be ≥ the term's minimum (e.g. ≥ 110 for CIF).
5. `oracles[]` must have at least one non-zero entry (at least one dispute resolution oracle).
6. On success, a new UTXO is produced with `status = CREATED`, term defaults populated, and all fields set as specified.
7. `term` is immutable after creation — it cannot be changed via any subsequent entrypoint.

##### ship

```
ship(
    bytes32 carrier                // carrier identity
)
```

Seller ships the goods. Caller must be the `seller`. Rules:

1. `status` must be `CREATED`.
2. If `freight_prepaid == 0x01` (seller pays freight): seller is responsible for arranging carriage. The `carrier` parameter records which carrier was engaged.
3. If `freight_prepaid == 0x00` (buyer pays freight): `carrier` must be set to the carrier nominated by the buyer. Buyer must have communicated carrier identity off-chain before `ship` is invoked.
4. On success, `status` transitions to `SHIPPED`, `shipment_block = current_block`, and `carrier` is written to state.
5. **Risk transfer**: At the point of shipment, risk transfers from seller to buyer for FOB and CIF terms. For EXW, risk transfers when buyer collects (invoked via a separate risk transfer action). For DDP, risk transfers at delivery. The `risk_transfer_block` is set according to the term rule.

##### deliver

```
deliver()
```

Goods arrive at destination. Caller is the `carrier` or a designated logistics oracle. Rules:

1. `status` must be `SHIPPED` or `IN_TRANSIT`.
2. `current_block` must be > `shipment_block` (cannot deliver before shipping).
3. On success, `status` transitions to `DELIVERED` and `delivery_block = current_block`.
4. For DDP: `risk_transfer_block` is set to `current_block` (risk transfers at delivery).

##### accept

```
accept()
```

Buyer accepts delivery of goods. Caller must be the `buyer`. Rules:

1. `status` must be `DELIVERED`.
2. On success, `status` transitions to `ACCEPTED` (terminal success).
3. If this Incoterms covenant is composed with a UCP600 covenant, acceptance may trigger document release under the LC (off-chain integration).

##### dispute

```
dispute(
    bytes32 evidence_digest        // blake2b hash of dispute evidence
)
```

Either party raises a dispute. Caller must be `seller` or `buyer`. Rules:

1. `status` must be `SHIPPED`, `IN_TRANSIT`, or `DELIVERED`.
2. `evidence_digest` must be non-zero (dispute evidence is required).
3. On success, `status` transitions to `DISPUTED`. `dispute_digest` is written to state.
4. Resolution follows the oracle escalation path: the first oracle in `oracles[]` is invoked; if unavailable or unresponsive, the next oracle is tried.
5. Oracle determines outcome and invokes `resolve`.

##### resolve

```
resolve(
    byte    outcome                // resolution outcome
)
```

Oracle resolves a dispute. Caller must be one of the `oracles[]`. Rules:

1. `status` must be `DISPUTED`.
2. `outcome` values:
   - `0x00`: dispute dismissed — delivery proceeds, return to prior status
   - `0x01`: uphold buyer — buyer may reject goods, seller liable for costs
   - `0x02`: uphold seller — buyer must accept goods, buyer liable for costs
   - `0x03`: partial — damages/price adjustment determined off-chain
3. On success, `status` transitions to `RESOLVED` (terminal).

### Encoding

This standard specifies the semantic interface and state layout for trade finance covenants. Documents are verified by hash (blake2b), not content — the covenant does not store or inspect document contents. For the byte-level encoding of identities and signature verification, see KCC-0014 (Soulbound Token). For the transfer and owner authorization pattern, see KCC-0020.

The 5-banking-day examination window in UCP600 corresponds to approximately 7,200 blocks at 1 block per second (assuming 24-hour banking days). Implementations should parameterize this value at deployment to accommodate different block times.

Document hashes use blake2b with 32-byte output. The hash covers the entire document as a byte sequence, including any digital signatures or attestations. Document formats are off-chain and outside the scope of this convention.

### Descriptors

#### UCP600Descriptor

Each UCP600 covenant deployment must publish a descriptor:

```
UCP600Descriptor {
    prefix: bytes                // covenant script bytes before mutable state
    suffix: bytes                // covenant script bytes after mutable state
    kcc20_transfer: bool         // true if covenant supports KCC-0020 transfer semantics
    max_documents: uint8         // maximum number of required documents (default: 8)
    examination_window: uint64   // examination window in blocks (default: 432000 = ~5 banking days)
    supported_currencies: bytes3[] // ISO 4217 currencies accepted
    requires_kcc0014: bool       // true if identities must be KCC-0014 compliant
}
```

#### IncotermsDescriptor

Each Incoterms covenant deployment must publish a descriptor:

```
IncotermsDescriptor {
    prefix: bytes                // covenant script bytes before mutable state
    suffix: bytes                // covenant script bytes after mutable state
    supported_terms: byte[]      // list of Incoterm codes supported (e.g. [0x00, 0x01, 0x02, 0x03])
    oracle_set: bytes32[]        // default dispute resolution oracles
    requires_kcc0014: bool       // true if identities must be KCC-0014 compliant
}
```

### KCC-0020 Alignment

This standard is honest about its relationship to KCC-0020. Trade finance covenants are NOT fungible tokens and do NOT implement the KCC-0020 transfer pattern. Alignment is at the architectural level:

- **State layout discipline**: Both conventions use byte-level offset/size/field/encoding tables in the same format as KCC-0008 (which extends KCC-0020).
- **Identity model**: Both conventions reference KCC-0014 soulbound identities for `issuing_bank`, `beneficiary`, `applicant`, `seller`, `buyer`, and `carrier`. This ensures that all trade finance participants are KYC-verified.
- **Descriptor pattern**: Both conventions adopt the `prefix/suffix` descriptor convention for wallet and indexer identification.
- **Oracle integration**: The Incoterms `dispute`/`resolve` path uses a configurable oracle set, consistent with the oracle model in KCC-0020 extended states.
- **Payment settlement**: UCP600 payment outputs reference the `lc_amount` and `currency` fields, which are compatible with any Kaspa value transfer covenant. Actual settlement uses native KAS or a KCC-0008 fungible token — the UCP600 covenant does not custody funds directly; it authorizes the payment.

Where this standard diverges from KCC-0020:

- No `transfer`/`transfer_delegator` leader pattern — trade finance covenants are state machines, not asset transfer vehicles.
- No `Borrowed Receive` extension — the covenants do not pool balances across UTXOs.
- No `extended_state_digest` indirection — state is laid out flat because trade finance state is bounded and self-contained.
- Documents are verified by hash, not token balances — the covenant's primary function is attestation, not custody.

### Composability

A complete trade finance transaction assembles four covenants:

```
Buyer ──purchase order──▶ Seller
Seller ──ship goods──────▶ Carrier (Incoterms covenant)
Buyer ──open LC──────────▶ Issuing Bank (UCP600 covenant)
Seller ──present docs────▶ Issuing Bank (UCP600 covenant)
Seller ──issue invoice───▶ CommerceInvoice covenant
Fees ──calculated────────▶ CommerceFeeCovenant
Issuing Bank ──pay───────▶ Seller (UCP600 covenant triggers settlement)
```

**Composition contract** (off-chain coordination, enforced by covenant cross-references):

1. **UCP600** references the Incoterms covenant via `document_hashes[]` — the bill of lading must match the Incoterms terms.
2. **Incoterms** references `lc_amount` from UCP600 — delivery is conditional on LC issuance.
3. **CommerceInvoice** aligns invoice amount with `lc_amount` and Incoterms `port_of_loading`.
4. **CommerceFeeCovenant** calculates bank charges, freight costs, and insurance premiums based on UCP600 and Incoterms fields.

Each covenant is independently verifiable. The composition is proved off-chain by verifying all four covenant states against the transaction hash.

### Profiles

Wallets and trade finance platforms detect covenant behavior from the published descriptor:

| Profile | Detection | Entrypoints |
|---------|-----------|-------------|
| **UCP600 LC** | Descriptor `prefix` matches UCP600 script | issue, present, examine, pay, notice_discrepancy, amend, cancel, expire |
| **Incoterms Delivery** | Descriptor `prefix` matches Incoterms script | create, ship, deliver, accept, dispute, resolve |

A single trade transaction may instantiate one UCP600 covenant and one Incoterms covenant, linked by document hashes and identity fields.

### Rules

1. **UCP600 irrevocability**: If `BIT_IRREVOCABLE` is set at issuance, the LC cannot be cancelled or amended without beneficiary consent (UCP 600 Article 3).
2. **Examination window**: The issuing bank must examine documents within 5 banking days of presentation. Failure to examine within this window constitutes acceptance (UCP 600 Article 14(b)).
3. **Discrepancy specificity**: A discrepancy notice must enumerate each specific discrepancy. A generic notice ("documents non-compliant") is invalid per UCP 600 Article 16(c)(ii).
4. **Document hash equality**: Compliance is determined by exact hash match between `document_hashes[]` and `presented_hashes[]`. No partial matching, no fuzzy comparison.
5. **Incoterms term immutability**: The `term` field is set at `create` and cannot be modified by any subsequent entrypoint.
6. **Risk transfer**: Risk transfers from seller to buyer at the point defined by the selected Incoterm: EXW at collection, FOB/CIF on board vessel at loading port, DDP at named destination.
7. **Freight and insurance**: The party responsible for freight and insurance is determined by the Incoterm and encoded in `freight_prepaid` and `insurance_required`. These are set at `create` and are immutable.
8. **Expiry enforcement**: Presentation after `expiry_block` is invalid. The `expire` entrypoint is invocable by anyone after expiry.
9. **Identity verification**: All participant identities (`issuing_bank`, `beneficiary`, `applicant`, `seller`, `buyer`, `carrier`) must be valid KCC-0014 soulbound identities with active status.
10. **Dispute escalation**: Incoterms disputes escalate through the ordered `oracles[]` array. If the first oracle is unresponsive for a configurable timeout, the next oracle is tried.
11. **Terminal states**: `EXPIRED`, `CANCELLED`, `PAID` (UCP600) and `ACCEPTED`, `RESOLVED` (Incoterms) are terminal — no further state transitions are permitted.
12. **Descriptor publication**: Both UCP600 and Incoterms descriptors must be published before any wallet, indexer, or trade finance platform can interact with the covenant.

## Reference

- **UCP 600**: ICC Uniform Customs and Practice for Documentary Credits, 2007 Revision (ICC Publication No. 600). The governing rules for letters of credit. Articles 3 (interpretation), 14 (standard for examination), 15 (complying presentation), and 16 (discrepant documents) are directly encoded in this convention.
- **Incoterms 2020**: ICC International Commercial Terms, 2020 Edition (ICC Publication No. 723). Defines EXW, FOB, CIF, DDP and eight other terms. This convention implements the four most commonly used in trade finance.
- **KCC-0014**: Soulbound Token Standard — identity model for all trade finance participants.
- **KCC-0020**: Fungible Token Covenant Specification — architectural patterns for state layout and descriptors.
- **CommerceInvoice / CommerceFeeCovenant**: Vida Commerce covenants for invoicing and fee calculation. Composed with this convention for complete trade transactions.

The author maintains a conforming implementation. This document defines the convention; an implementation demonstrates conformance.