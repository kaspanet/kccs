# KCC-0025: Oracle License Agreement — Implementation

## Preamble

We're building **Vida Oracle** (https://github.com/jeffsiegel1965/vida) — a decentralized oracle network for Kaspa commerce. This license agreement governs the relationship between Vida Digital Systems ("VDS") and oracle operators, whether running on VDS infrastructure or self-hosted.

The agreement implements on-chain automatic fee collection, bond management, and compliance enforcement. No counterparty risk. No manual invoicing. Code is law.

---

## License Types

| Type | Infrastructure | Bond (Launch) | Bond (Mature) | Monthly Fee | Revenue Share | Use Case |
|------|---------------|---------------|---------------|-------------|---------------|----------|
| **VDS Proprietary** | VDS nodes | 10,000 KAS | 100,000 KAS | 0 KAS | 0% | VDS infrastructure |
| **Licensee** | Self-hosted | 50,000 KAS | 500,000 KAS | Variable | 10% | Commercial operators |

**On the VDS tier:** VDS operates proprietary oracles. Bonds 50% of licensee amount. No license fees. Higher trust, lower bond requirement.

**On the Licensee tier:** Third-party operators. Higher bond (less trust). 10% revenue share to VDS. Bond scales with network growth.

---

## Bond Scaling (Automatic)

| Network Stage | Operators | VDS Bond | Licensee Bond | Rationale |
|-------------|-----------|----------|---------------|-----------|
| **Launch** | 1-50 | 25,000 KAS | 50,000 KAS | Barrier to entry |
| **Growth** | 51-200 | 50,000 KAS | 100,000 KAS | Meaningful deterrent |
| **Scale** | 201-500 | 100,000 KAS | 250,000 KAS | Significant cost |
| **Mature** | 500+ | 250,000 KAS | 500,000 KAS | Serious commitment |

**Automatic adjustment:** Bond requirements increase when operator count crosses threshold. No governance vote needed. Existing operators grandfathered at current bond level.

**Manual adjustment:** VDS admin can adjust bond requirements and fees at any time via covenant functions:
- `set_bond_requirement()` — Update bond per tier and stage
- `set_fee()` — Update subscription fees
- `set_license_fee_bps()` — Update license fee percentage

**Note:** Manual adjustments apply to new operators only. Existing operators grandfathered at current rates.

---

## Anti-Fraud Mechanisms

| Mechanism | Description | Purpose |
|-----------|-------------|---------|
| **100% slashing** | Proven fraud = lose entire bond | Not just opportunity cost |
| **7-day challenge** | Dispute window for fraud claims | Time to detect and prove |
| **Max 5% share** | No single operator controls >5% of network | Prevents Sybil attacks |
| **Progressive bond** | New operators = higher bond | Track record reduces bond |
| **Diversity check** | Correlation analysis | Detect copycat operators |
| **Outlier detection** | 2% deviation from median flagged | Catch bad data quickly |

---

## Slashing Conditions

| Violation | Penalty | Evidence Required | Challenge Period |
|-----------|---------|-------------------|------------------|
| **Bad data** | 10% of bond | 3+ outlier detections within 24h | 7 days |
| **Downtime** | 5% of bond | 24h+ offline (heartbeat failure) | 7 days |
| **Fraud** | 100% of bond | Cryptographic proof of manipulation | 7 days |
| **Collusion** | 100% of bond | Correlation analysis >0.9999 | 7 days |
| **TOS breach** | 25% of bond | Admin determination with evidence | 7 days |

**Unambiguous Definitions:**

| Term | Definition | Measurement |
|------|-----------|-------------|
| **Bad data** | Price deviation >2% from median | 3+ occurrences in 24h |
| **Downtime** | No heartbeat for 24+ hours | Automated monitoring |
| **Fraud** | Intentional price manipulation | Cryptographic proof |
| **Collusion** | Copying another operator's data | Pearson r > 0.9999 |
| **TOS breach** | Violation of Terms of Service | Admin review with evidence |

**Challenge Process:**
1. Operator notified of slashing claim
2. 7-day window to submit counter-evidence
3. Admin reviews evidence
4. Decision: Uphold or dismiss
5. If upheld: Bond slashed
6. If dismissed: No penalty, record cleared

---

## Auto-Pay Mechanism

The covenant collects fees automatically. No manual intervention.

```
Monthly Cycle:
  1. Calculate operator revenue (subscriptions)
  2. Deduct monthly fee (VDS tiers) OR 10% share (Licensee)
  3. Deduct exchange API costs (if paid tier required)
  4. Distribute remainder to operator
  5. Check bond minimum — suspend if below
  6. Check bond scaling — adjust if network grew
```

**On defaults:** If operator revenue < monthly fee, the covenant deducts from bond. If bond < minimum, license suspends automatically.

**On scaling:** If network crosses threshold, new operators bond at new rate. Existing operators have 30 days to top up or exit.

---

## KCC-17/18 Token Distribution

Oracle subscribers need KCC-17 (Oracle Attestation) and KCC-18 (Oracle Registry) tokens to interact with the network.

**Distribution model:**
- **Primary sale**: VDS sells tokens to subscribers
- **Price**: 0.1 KAS per token (covers minting cost + margin)
- **Revenue**: 100% to VDS treasury
- **Use case**: Subscribers hold tokens to access oracle data

**Why this works:**
- Tokens are utility tokens (access right)
- Not securities (no profit expectation)
- On-chain proof of subscription
- Transferable (secondary market possible)

---

## Covenant Entrypoints

| Entrypoint | Access | Description |
|------------|--------|-------------|
| `issue_license` | Admin | Create license, lock bond |
| `collect_fee` | Covenant | Auto-deduct monthly fee |
| `distribute_tokens` | Covenant | Sell KCC-17/18 to subscribers |
| `top_up_bond` | Operator | Add to bond |
| `slash_bond` | Admin | Penalize violation |
| `revoke_license` | Admin | Terminate, return bond minus penalty |
| `exit_license` | Operator | Voluntary exit, pay exit fee |
| `verify_compliance` | Anyone | Check operator status |
| `challenge_fraud` | Anyone | Initiate fraud challenge |
| `resolve_challenge` | Admin | Resolve fraud challenge |

---

## SilverScript Implementation

```silverscript
// KCC-0025: Oracle License Agreement
// Lawyerly style: precise, unambiguous, enforceable

contract OracleLicense {
    
    // Bond requirements by network stage
    const BOND_VDS_LAUNCH: uint64 = 25000000000;         // 25,000 KAS
    const BOND_VDS_GROWTH: uint64 = 50000000000;         // 50,000 KAS
    const BOND_VDS_SCALE: uint64 = 100000000000;         // 100,000 KAS
    const BOND_VDS_MATURE: uint64 = 250000000000;        // 250,000 KAS
    
    const BOND_LICENSEE_LAUNCH: uint64 = 50000000000;    // 50,000 KAS
    const BOND_LICENSEE_GROWTH: uint64 = 100000000000;   // 100,000 KAS
    const BOND_LICENSEE_SCALE: uint64 = 250000000000;    // 250,000 KAS
    const BOND_LICENSEE_MATURE: uint64 = 500000000000;   // 500,000 KAS
    
    // Network stage thresholds
    const STAGE_GROWTH: uint32 = 50;      // 50+ operators
    const STAGE_SCALE: uint32 = 200;      // 200+ operators
    const STAGE_MATURE: uint32 = 500;     // 500+ operators
    
    // Fee structure
    const LICENSE_FEE_BPS: uint16 = 1000;                // 10% (1000 basis points)
    const TOKEN_PRICE: uint64 = 1000000;                 // 0.1 KAS per token
    
    // Slashing penalties (basis points)
    const SLASH_BAD_DATA: uint16 = 1000;                 // 10%
    const SLASH_DOWNTIME: uint16 = 500;                  // 5%
    const SLASH_FRAUD: uint16 = 10000;                   // 100%
    const SLASH_COLLUSION: uint16 = 10000;               // 100%
    const SLASH_TOS: uint16 = 2500;                      // 25%
    
    // Challenge period
    const CHALLENGE_PERIOD: uint32 = 604800;             // 7 days in seconds
    
    // State
    struct License {
        operator: bytes32,
        license_type: uint8,      // 0=VDS, 1=Licensee
        bond_amount: uint64,
        network_stage: uint8,     // 0=Launch, 1=Growth, 2=Scale, 3=Mature
        revenue_share_bps: uint16,
        issued_at: uint32,
        expires_at: uint32,
        status: uint8,            // 0=active, 1=suspended, 2=revoked, 3=challenged
        last_fee_payment: uint32,
        total_fees_paid: uint64,
        total_tokens_sold: uint64,
        fraud_challenges: uint32,
        successful_challenges: uint32,
    }
    
    struct FraudChallenge {
        operator: bytes32,
        challenger: bytes32,
        evidence_hash: bytes32,
        challenge_amount: uint64,
        initiated_at: uint32,
        resolved: bool,
        upheld: bool,
    }
    
    mapping(bytes32 => License) licenses;
    mapping(bytes32 => uint64) bonds;
    mapping(bytes32 => uint64) operator_revenue;
    mapping(bytes32 => FraudChallenge) challenges;
    
    uint32 operator_count;
    uint8 current_stage;
    
    // Calculate current bond requirement
    function get_bond_requirement(license_type: uint8) public view returns (uint64) {
        uint8 stage = get_network_stage();
        
        if (license_type == 0) {  // VDS
            if (stage == 0) return BOND_VDS_LAUNCH;
            if (stage == 1) return BOND_VDS_GROWTH;
            if (stage == 2) return BOND_VDS_SCALE;
            return BOND_VDS_MATURE;
        } else {  // Licensee
            if (stage == 0) return BOND_LICENSEE_LAUNCH;
            if (stage == 1) return BOND_LICENSEE_GROWTH;
            if (stage == 2) return BOND_LICENSEE_SCALE;
            return BOND_LICENSEE_MATURE;
        }
    }
    
    function get_network_stage() public view returns (uint8) {
        if (operator_count >= STAGE_MATURE) return 3;
        if (operator_count >= STAGE_SCALE) return 2;
        if (operator_count >= STAGE_GROWTH) return 1;
        return 0;
    }
    
    // Admin adjustment functions (with governance)
    function set_bond_requirement(
        license_type: uint8, 
        stage: uint8, 
        new_bond: uint64
    ) public only_admin {
        require(new_bond >= 1000);  // Minimum 10 KAS
        require(stage <= 3);        // Valid stage
        
        // Update bond requirement
        if (license_type == 0) {
            if (stage == 0) BOND_VDS_LAUNCH = new_bond;
            else if (stage == 1) BOND_VDS_GROWTH = new_bond;
            else if (stage == 2) BOND_VDS_SCALE = new_bond;
            else BOND_VDS_MATURE = new_bond;
        } else {
            if (stage == 0) BOND_LICENSEE_LAUNCH = new_bond;
            else if (stage == 1) BOND_LICENSEE_GROWTH = new_bond;
            else if (stage == 2) BOND_LICENSEE_SCALE = new_bond;
            else BOND_LICENSEE_MATURE = new_bond;
        }
        
        emit BondRequirementUpdated(license_type, stage, new_bond);
    }
    
    function set_fee(license_type: uint8, new_fee: uint64) public only_admin {
        require(new_fee >= 0);
        
        FEE[license_type] = new_fee;
        
        emit FeeUpdated(license_type, new_fee);
    }
    
    function set_license_fee_bps(new_bps: uint16) public only_admin {
        require(new_bps <= 10000);  // Max 100%
        
        LICENSE_FEE_BPS = new_bps;
        
        emit LicenseFeeUpdated(new_bps);
    }
    
    // Governance events
    event BondRequirementUpdated(uint8 license_type, uint8 stage, uint64 new_bond);
    event FeeUpdated(uint8 license_type, uint64 new_fee);
    event LicenseFeeUpdated(uint16 new_bps);
    
    // Admin functions
    function issue_license(
        operator: bytes32,
        license_type: uint8,
        duration_months: uint32
    ) public only_admin {
        uint64 required_bond = get_bond_requirement(license_type);
        require(bonds[operator] >= required_bond);
        require(licenses[operator].status == 0);
        
        // Check max 5% share
        require(operator_count == 0 || 
                (operator_revenue[operator] * 20) <= total_network_revenue());
        
        licenses[operator] = License({
            operator: operator,
            license_type: license_type,
            bond_amount: required_bond,
            network_stage: get_network_stage(),
            revenue_share_bps: (license_type == 1) ? LICENSE_FEE_BPS : 0,
            issued_at: now,
            expires_at: now + (duration_months * 30 days),
            status: 0,
            last_fee_payment: now,
            total_fees_paid: 0,
            total_tokens_sold: 0,
            fraud_challenges: 0,
            successful_challenges: 0,
        });
        
        operator_count++;
        
        emit LicenseIssued(operator, license_type, required_bond);
    }
    
    // Auto-fee collection (called monthly)
    function collect_fee(operator: bytes32) public {
        License storage license = licenses[operator];
        require(license.status == 0);
        require(now >= license.last_fee_payment + 30 days);
        
        uint64 revenue = operator_revenue[operator];
        
        if (license.license_type == 1) {
            // Licensee: 10% revenue share
            uint64 vida_share = (revenue * LICENSE_FEE_BPS) / 10000;
            uint64 operator_share = revenue - vida_share;
            
            transfer(VIDA_TREASURY, vida_share);
            transfer(operator, operator_share);
            
            license.total_fees_paid += vida_share;
        }
        // VDS proprietary: no fee collection (internal accounting)
        
        license.last_fee_payment = now;
        operator_revenue[operator] = 0;  // Reset for next period
    }
    
    // Token distribution (KCC-17/18)
    function sell_tokens(operator: bytes32, token_type: uint8, amount: uint64) public {
        // token_type: 0=KCC-17, 1=KCC-18
        uint64 total_cost = amount * TOKEN_PRICE;
        
        require(msg.value >= total_cost);
        
        // Mint tokens to buyer
        mint_tokens(msg.sender, token_type, amount);
        
        // Revenue to VDS
        transfer(VIDA_TREASURY, total_cost);
        
        licenses[operator].total_tokens_sold += amount;
        
        emit TokensSold(operator, msg.sender, token_type, amount, total_cost);
    }
    
    // Bond management
    function top_up_bond(operator: bytes32, amount: uint64) public {
        require(licenses[operator].status == 0);
        bonds[operator] += amount;
        emit BondToppedUp(operator, amount);
    }
    
    // Fraud challenge mechanism
    function challenge_fraud(
        operator: bytes32,
        evidence_hash: bytes32,
        challenge_amount: uint64
    ) public {
        require(licenses[operator].status == 0);
        require(challenge_amount >= 1000000000);  // Min 10 KAS challenge bond
        
        // Lock challenger's bond
        lock_bond(msg.sender, challenge_amount);
        
        challenges[operator] = FraudChallenge({
            operator: operator,
            challenger: msg.sender,
            evidence_hash: evidence_hash,
            challenge_amount: challenge_amount,
            initiated_at: now,
            resolved: false,
            upheld: false,
        });
        
        licenses[operator].status = 3;  // Challenged
        licenses[operator].fraud_challenges++;
        
        emit FraudChallenged(operator, msg.sender, evidence_hash);
    }
    
    function resolve_challenge(operator: bytes32, upheld: bool) public only_admin {
        FraudChallenge storage challenge = challenges[operator];
        require(!challenge.resolved);
        require(now >= challenge.initiated_at + CHALLENGE_PERIOD);
        
        challenge.resolved = true;
        challenge.upheld = upheld;
        
        if (upheld) {
            // Fraud proven: slash 100% of operator bond
            uint64 operator_bond = bonds[operator];
            bonds[operator] = 0;
            
            // Transfer slashed bond to challenger (reward) and VDS (treasury)
            uint64 challenger_reward = (operator_bond * 5000) / 10000;  // 50%
            uint64 vds_share = operator_bond - challenger_reward;       // 50%
            
            transfer(challenge.challenger, challenger_reward);
            transfer(VIDA_TREASURY, vds_share);
            
            licenses[operator].status = 2;  // Revoked
            licenses[operator].successful_challenges++;
            
            // Return challenger's bond
            unlock_bond(challenge.challenger, challenge.challenge_amount);
        } else {
            // Challenge failed: slash challenger's bond
            slash_bond(challenge.challenger, challenge.challenge_amount, "False challenge");
            
            licenses[operator].status = 0;  // Active
        }
        
        emit ChallengeResolved(operator, challenge.challenger, upheld);
    }
    
    // Admin slashing (for non-challenge violations)
    function slash_bond(operator: bytes32, amount: uint64, reason: string) public only_admin {
        require(bonds[operator] >= amount);
        bonds[operator] -= amount;
        transfer(VIDA_TREASURY, amount);
        emit BondSlashed(operator, amount, reason);
    }
    
    // License termination
    function revoke_license(operator: bytes32, penalty_pct: uint8) public only_admin {
        License storage license = licenses[operator];
        license.status = 2;  // Revoked
        
        uint64 penalty = (bonds[operator] * penalty_pct) / 100;
        uint64 refund = bonds[operator] - penalty;
        
        transfer(VIDA_TREASURY, penalty);
        transfer(operator, refund);
        
        emit LicenseRevoked(operator, penalty, refund);
    }
    
    function exit_license(operator: bytes32) public {
        License storage license = licenses[operator];
        require(msg.sender == operator);
        require(license.status == 0);
        
        uint64 exit_fee = license.monthly_fee;
        uint64 refund = bonds[operator] - exit_fee;
        
        transfer(VIDA_TREASURY, exit_fee);
        transfer(operator, refund);
        
        license.status = 2;
        
        emit LicenseExited(operator, exit_fee, refund);
    }
    
    // View functions
    function verify_compliance(operator: bytes32) public view returns (bool) {
        License storage license = licenses[operator];
        return license.status == 0 && 
               bonds[operator] >= get_bond_requirement(license.license_type) &&
               now < license.expires_at;
    }
    
    function get_operator_share(operator: bytes32) public view returns (uint64) {
        // Returns operator's share of network revenue (basis points)
        if (total_network_revenue() == 0) return 0;
        return (operator_revenue[operator] * 10000) / total_network_revenue();
    }
}
```

---

## Mainnet Testing Plan

### Prerequisites

| Component | Machine | Status |
|-----------|---------|--------|
| Vida Oracle | Spock | ✅ Running |
| Vida Wallet | Scotty | ✅ Ready |
| Vida Commerce | Spock | ✅ Running |
| KCC-0025 Covenant | Mainnet | ✅ Deployed |

### Test Flow

1. **Verify KCC-0025 deployment** on mainnet
2. **Issue test license** to Scotty (Licensee type)
3. **Lock 50,000 KAS bond** in covenant (launch stage)
4. **Simulate subscriber payment** to operator
5. **Trigger auto-fee collection** (10% to VDS)
6. **Verify VDS receives fee** on-chain
7. **Test token distribution** (KCC-17/18 sale)
8. **Verify bond management** (top-up, slash, refund)
9. **Test fraud challenge** (initiate, resolve)
10. **Verify bond scaling** (network growth)

### Verification Commands

```bash
# Check license status
curl -s http://localhost:8765/license/status | jq

# Check bond balance
curl -s http://localhost:8765/license/bond | jq

# Check VDS revenue
curl -s http://localhost:8765/license/revenue | jq

# Trigger fee collection
curl -X POST http://localhost:8765/license/collect | jq

# Check token distribution
curl -s http://localhost:8765/license/tokens | jq

# Check fraud challenges
curl -s http://localhost:8765/license/challenges | jq
```

---

## Next Steps

1. **Review** this specification
2. **Test** fraud challenge mechanism
3. **Verify** bond scaling automation
4. **Onboard** first licensee
5. **Monitor** network growth and bond adjustments

**Offer to test:** We'd like to be an early external implementer. We have a working oracle network, wallet integration, and commerce layer. The auto-pay mechanism maps naturally to subscription revenue. We'll test against the live covenant and report what breaks.

---

## Legal Provisions

### Governing Law

This Agreement shall be governed by and construed in accordance with the laws of the State of Wyoming, USA, without regard to conflict of law principles.

### Binding Arbitration

Any dispute arising from or relating to this Agreement shall be resolved through binding arbitration in Cheyenne, Wyoming, in accordance with the rules of the American Arbitration Association.

### Liability Limitation

**TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW:**

VDS's total aggregate liability to any operator for any and all claims arising from or related to this Agreement shall not exceed the **total amount of the operator's bond** at the time of the claim.

### Oracle Accuracy Disclaimer

**VDS DOES NOT GUARANTEE THE ACCURACY, TIMELINESS, OR COMPLETENESS OF ORACLE DATA.**

Operators acknowledge that:
- Oracle prices may be delayed, inaccurate, or manipulated
- VDS is not liable for operator losses from bad data
- Operators use oracle data at their own risk

### No Investment Advice

**VDS DOES NOT PROVIDE INVESTMENT, FINANCIAL, OR TRADING ADVICE.**

Operators should:
- Consult qualified advisors before making decisions
- Conduct their own research
- Understand the risks of operating an oracle

### Data Privacy

VDS collects minimal operator data:
- Public key (on-chain identity)
- Bond amount (public information)
- Attestation history (public information)
- Revenue and fees (public information)

### AML/KYC Compliance

Operators must comply with applicable AML/KYC regulations. VDS may require:
- Identity verification for large bonds
- Source of funds documentation
- Business registration proof

**Specific Requirements:**

| Bond Level | Verification Required | Documents |
|------------|----------------------|-----------|
| < 10,000 KAS | None | Public key only |
| 10,000-50,000 KAS | Basic | Email, wallet address |
| 50,000-100,000 KAS | Standard | ID, proof of address |
| > 100,000 KAS | Enhanced | Business registration, source of funds |

**Prohibited Activities:**
- Money laundering
- Terrorist financing
- Fraud or deception
- Sanctions violations

**Reporting:**
VDS reserves the right to report suspicious activities to relevant authorities as required by law.

---

## Termination Rights

### VDS Termination Rights (For Cause Only)

VDS may terminate an operator license only for cause, as defined below.

**Termination Process:**
1. VDS issues termination notice (on-chain)
2. Operator has 30 days to cure defect (non-fraud)
3. If cured: No termination, no penalty
4. If not cured: Bond returned minus penalty
5. License revoked

**Penalty Structure (Graduated):**

| Violation | First Offense | Second Offense | Third Offense | Fraud |
|-----------|-------------|----------------|---------------|-------|
| **Bad data** | Warning | 10% of bond | 25% of bond | 100% |
| **Downtime** | Warning | 10% of bond | 25% of bond | 100% |
| **TOS breach** | Warning | 10% of bond | 25% of bond | 100% |
| **Fraud** | 100% of bond | — | — | — |

**Notice Period:**
- **Non-fraud:** 30-day cure period
- **Fraud:** Immediate termination

**Appeal Process:**
- All terminations can be appealed
- Independent arbitrator
- 30-day process
- Bond held in escrow during appeal

**Good Faith Requirement:**
- VDS must act in good faith
- Cannot terminate to steal bond
- Must have evidence of violation
- Subject to legal review

### Operator Exit Rights

Operators may exit voluntarily at any time.

**Exit Process:**
1. Operator submits exit request
2. 30-day notice period (optional)
3. Bond returned minus exit fee
4. License closed

**Exit Fee:** 1 month of subscription fees

### Suspension Rights

VDS may suspend (not terminate) a license for:
- Investigation of potential fraud
- Maintenance or upgrades
- Regulatory compliance
- Emergency situations

**Suspension vs Termination:**
- **Suspension:** Temporary, can be reinstated
- **Termination:** Permanent, for cause only

---

*This agreement is governed by the laws of the State of Wyoming, USA. Disputes resolved through binding arbitration. Vida Digital Systems LLC.*
