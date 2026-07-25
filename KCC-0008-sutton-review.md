# KCC-0008: Sutton-Level Review — Multi-Token Standard

**Review date**: 2026-07-25  
**Reviewed against**: KCC-0020 (Fungible Token Covenant Specification by Manyfest, Michael Sutton, IzioDev)  
**Methodology**: Line-by-line byte-level state layout verification, entrypoint signature comparison, KCC-0020 alignment audit, NFT vs fungible coherence analysis, rules enforceability check

---

## EXECUTIVE SUMMARY

KCC-0008 is a well-structured spec at the conceptual level, but it has **three BLOCKERS** against the KCC-0020 quality bar. Two stem from a critical structural difference: KCC-0008 omits `identifierType`, which is a core field in KCC-0020's state header. The third is an undefined freeze/unfreeze model that contradicts the flag's per-token location. These issues cascade into Borrowed Receive semantics, descriptor format, and owner-authority model. Multiple MAJOR issues exist around entrypoint signatures, missing state sub-layouts, and dangling cross-references. Seven MINOR issues cover specification clarity and edge cases.

**Bottom line**: KCC-0008 cannot claim to "adopt KCC-0020's transfer convention" in its current form. It defines a *different* state header that is incompatible with KCC-0020's three-field layout (`ownerIdentifier` + `identifierType` + `amount`). This must be resolved before submission — either by adding `identifierType` to the standard header, or by honestly documenting the divergence.

---

## BLOCKERS (3)

### B1. Missing `identifierType` in state header (lines 27–35, 287–303) — **BLOCKER**

**What KCC-0020 requires**: Every token state MUST include `identifierType` (byte, values: `PUBKEY=0x00`, `SCRIPT_HASH=0x01`, `COVENANT_ID=0x02`) alongside `ownerIdentifier` (bytes32). This is not optional — it is the field that tells wallets and covenants HOW to interpret `ownerIdentifier`.

**What KCC-0008 has**: Only `owner_id` (bytes32) at offset 10–41. No `identifierType`.

**Why it blocks**: 
- KCC-0008 line 287 claims to "adopt" KCC-0020's transfer interface. But KCC-0020's transfer loop depends on `identifierType` to resolve whether `ownerIdentifier` is a pubkey (for ECDSA validation), a script hash, or a covenant ID. Without it, a generic KCC-0020 reader/writer cannot validate KCC-0008 states.
- Line 292 claims Borrowed Receive "preserves `owner_id`, `token_kind`, `extended_digest`" — but KCC-0020's Borrowed Receive requires `identifierType` unchanged. Omitting the field means the spec cannot satisfy this constraint.
- The allowance companion covenant (lines 160–169) uses `holder_id`/`spender_id` as bare bytes32 — wallets cannot tell whether they're dealing with pubkeys, scripts, or covenants.
- Shawn's production DEX comment (KCC-0020 thread, post #24): "Our DEX pool... carries its own copy of the token's state struct (owner, type, amount...)" — `type` IS `identifierType`. This is the ecosystem's understood minimal header.

**Fix**: Add `identifierType` (1 byte) to the state header. Options:
- **Option A**: Append after `owner_id` (new offset 42, shifting `amount` to 43, `metadata_uri` to 51, `extended_digest` to 115 → total 147 bytes).
- **Option B**: Absorb into `token_kind` by reserving upper bits — e.g., `token_kind` bit 7 encodes owner type. This preserves the 146-byte size but is semantically confusing.

I recommend Option A. Yes, it breaks the 146-byte layout. Better to break it now than ship an incompatible header.

---

### B2. freeze/unfreeze semantics contradict BIT_FROZEN location (lines 49, 240–244, 330) — **BLOCKER**

**The conflict**:
- Line 49: `BIT_FROZEN` is defined in per-token state flags (offset 9, alongside `BIT_MINTED`/`BIT_BURNED`). It applies to individual token_id states.
- Lines 240–244: `freeze()` and `unfreeze()` take NO parameters and operate at "covenant-level." But a single KCC-0008 deployment can manage multiple token_ids — if freeze() is covenant-level, does it freeze ALL tokens? If so, how does it set BIT_FROZEN on every UTXO (which would require consuming and recreating every token UTXO — impractical)?
- Line 330 (Rule 8): "All state-changing entrypoints fail while BIT_FROZEN is set" — but `unfreeze()` is state-changing. Circular: if BIT_FROZEN is set, unfreeze can't clear it.

**Why it blocks**: The model is self-contradictory. An implementer cannot determine whether to check a per-UTXO flag, a covenant-global flag, or both.

**Fix**: Pick ONE model and be explicit:
- **Global freeze**: Move BIT_FROZEN to covenant-level state (outside the per-token header), and `freeze()/unfreeze()` modify that. Token entrypoints check it before allowing state changes. Document that the flag does NOT live in the per-token UTXO state.
- **Per-token_id freeze**: `freeze(uint64 token_id)` / `unfreeze(uint64 token_id)` — requires consuming and recreating every UTXO for that token_id, or adding a global state UTXO per token_id that entrypoints cross-reference.
- **Rule 8 rewrite**: "All token-state-changing entrypoints (transfer, mint, mint_batch, burn, approve, transfer_from) fail while BIT_FROZEN is set on the covenant-level state. `freeze` and `unfreeze` themselves are always callable by the covenant owner."

---

### B3. NFT model: no KCC-0020 identifierType = no inter-covenant composability (lines 14, 42–43, 82–83, 287) — **BLOCKER**

**The claim (line 14)**: "This standard defines one interface and one state layout for every token type on Kaspa, building on the transfer convention established by KCC-0020."

**The reality**: KCC-0020 defines `identifierType` with `COVENANT_ID = 0x02` specifically to enable covenant-owned tokens — a lending pool holding collateral, a DEX pool holding reserves, a vault holding deposits. Without `identifierType`, KCC-0008 tokens cannot be held by other covenants in a way that KCC-0020-compatible tooling can understand. This directly contradicts the claim of building on KCC-0020.

The NFT path (one UTXO per token_id) technically works with positional I/O (input[i] → output[i]), but the composability claim fails because the owner auth model is incomplete. A DEX covenant trying to hold a KCC-0008 NFT would need to know it's dealing with a COVENANT_ID owner — but without `identifierType`, it only sees 32 opaque bytes.

**Fix**: Same as B1 — add `identifierType` to the header. This is what makes the multi-token model genuinely composable with the KCC-0020 ecosystem.

---

## MAJOR (8)

### M1. Entrypoint signature: `transfer` omits `prevStates` parameter (lines 66–74) — **MAJOR**

KCC-0020's SilverScript signature (from the spec):
```silverscript
function transfer(State[] prevStates, State[] newStates, sig[] sigs, byte[] witnesses)
```

KCC-0008's signature (line 69):
```
transfer(State[] next_states, Sig[] signatures, byte[] witnesses)
```

KCC-0008 omits `prevStates`. In KCC-0020, the function receives ALL consumed covenant state as `prevStates` (via `from = maxCovIns` binding) and the declared next states as `newStates`. KCC-0008's `next_states` maps to `newStates`, but `prevStates` is missing from the declaration.

**Mitigation**: In SilverScript, `prevStates` may be implicit from the covenant binding. However, KCC-0020's function signature explicitly lists it. For a standard claiming to adopt KCC-0020, the signature should match unless there's a documented reason for divergence.

**Fix**: Either add `prevStates` to the signature or add an explicit note: "Unlike KCC-0020's SilverScript declaration which takes `prevStates` from covenant binding, this specification describes the leader's sigscript arguments where prevStates are inherent in the consumed UTXOs."

---

### M2. Token config state has no defined layout (lines 222–235) — **MAJOR**

`set_token_config` stores `max_supply` and `mint_expiry_block` per token_id. `mint` checks against `max_supply` (line 113). But these values have no location in the 146-byte standard header or any defined extended state sub-layout.

Without a defined location:
- An implementer doesn't know where to store or retrieve these values
- `mint` can't validate against `max_supply` at runtime
- Rule 6 (line 327) references `max_supply` but it has no home

**Fix**: Define a `TokenConfig` extended state sub-layout:
```
offset  size    field               encoding
0       8       max_supply          uint64, big-endian (0 = uncapped)
8       8       mint_expiry_block   uint64, big-endian (0 = never)
```
And specify that `extended_digest` commits to this when token config is active. Or add these to the standard header (breaks 146 bytes).

---

### M3. Royalty state has no defined location (lines 204–218) — **MAJOR**

`set_royalty` stores `recipient_id` and `bps` per token_id, with immutability after first call. No state layout exists for these values.

**Fix**: Define `RoyaltyConfig` extended state sub-layout:
```
offset  size    field           encoding
0       32      recipient_id    bytes32
32      2       bps             uint16, big-endian
```
And document that the immutability guarantee is enforced by the covenant checking that the royalty digest portion of `extended_digest` is either zero (unset) or matches the previous value.

---

### M4. Descriptor missing `state_layout`, `leader_entrypoint_selector`, and `delegator_entrypoint_selector` (lines 258–268) — **MAJOR**

KCC-0020's descriptor:
```
TokenDescriptor {
    prefix, suffix, state_layout,
    leader_entrypoint_selector, delegator_entrypoint_selector,
    optional_extensions
}
```

KCC-0008's descriptor (line 261):
```
KCC0008Descriptor {
    prefix, suffix, token_ids, multi_token_mode, kcc20_extensions
}
```

Missing:
- **`state_layout`**: Without it, a KCC-0020 reader cannot programmatically decode KCC-0008 state bytes. The reader can only decode if it hardcodes the KCC-0008 layout.
- **`leader_entrypoint_selector` / `delegator_entrypoint_selector`**: Without these, a KCC-0020 writer cannot construct valid sigscripts. KCC-0020's Writer section explicitly requires them for building input sigscripts.

**Fix**: Add all three fields. `state_layout` should describe the 146-byte header field-by-field. Selectors should be the compiled entrypoint identifiers.

---

### M5. Entrypoint signature: `transfer` parameter naming inconsistent with KCC-0020 (lines 69–74) — **MAJOR**

KCC-0008 uses `State[] next_states` and `Sig[] signatures`. KCC-0020 uses `State[] newStates` and `sig[] sigs`. While naming differences are cosmetic, `Sig` vs `sig` matters in SilverScript — `Sig` could be interpreted as a different type. The exact type declarations matter for ABI compatibility.

**Fix**: Align with KCC-0020 naming: `State[] new_states` (or `newStates`), `sig[] signatures`, `byte[] witnesses`. Or document the mapping explicitly.

---

### M6. Dangling reference to KCC-0001 (line 109) — **MAJOR**

Line 109: "Caller must be the covenant owner (see KCC-0001 for owner identification)."

KCC-0001 does not exist in the repository (16 files: KCC-0008 through KCC-0024, minus holes). This is a reference to an unpublished standard. Per the standards-writing skill: "No references to unpublished standards."

**Fix**: Either publish KCC-0001 first, or define covenant owner identification inline. Alternatively, define the owner as the entity identified in a covenant-specific owner state field (similar to how KCC-0020 uses `identifierType`).

---

### M7. Dangling reference to KCC-0021 (line 55) — **MAJOR**

Line 55: "See KCC-0021 for canonical metadata layout."

KCC-0021 does not exist in the repository. Same issue as M6.

**Fix**: Either publish KCC-0021 first, or define the metadata URI encoding inline. At minimum, specify: "metadata_uri is a 64-byte UTF-8 field, zero-padded. It contains a URI pointing to a JSON document conforming to the KCC-0021 format (forthcoming)."

---

### M8. Extended state digest: no rule for divergent inputs (line 62) — **MAJOR**

Line 62: "The standard transfer entrypoints treat extended state as opaque and preserve its digest unchanged across inputs who share the same `token_id`."

What happens when two inputs of the same token_id have DIFFERENT extended digest values? The spec is silent. KCC-0020's Extension State section says: "If inputs have different extension state, the Writer must fail instead of deciding how to combine custom state."

**Fix**: Add rule: "If multiple consumed states of the same `token_id` have different `extended_digest` values, the transfer MUST fail. The covenant cannot resolve which extension state is canonical."

---

## MINOR (7)

### m1. `mint` rule: `amount` check against `max_supply` should cover unconfigured case (line 113) — **MINOR**

Line 113: "If `token_kind == FUNGIBLE`: `amount` may be any value up to the configured `max_supply` for this `token_id`."

What if `set_token_config` has not been called yet? Is `max_supply` implicitly 0 (uncapped) until configured? The spec should state this explicitly.

**Fix**: Add: "If `max_supply` has not been configured (i.e., `set_token_config` has never been called for this `token_id`), `max_supply` defaults to 0 (uncapped). A value of 0 means no supply cap."

---

### m2. `burn` flags modification: ambiguous whether BIT_BURNED clears other flags (line 138) — **MINOR**

Line 138: "the burned state's `flags` is set to `BIT_BURNED`."

This reads as assignment (`flags = BIT_BURNED`), which would clear `BIT_MINTED`. It should be bitwise OR: "`BIT_BURNED` is set in `flags`."

**Fix**: Change to "the `BIT_BURNED` flag is set" or "flags = flags | BIT_BURNED".

---

### m3. `burn` for NFTs: ignored `amount` parameter is an API hazard (line 140) — **MINOR**

Line 140: "For non-fungible tokens (`token_kind == NON_FUNGIBLE`): `amount` is ignored; the entire token is burned."

If `amount` is ignored, the covenant should still validate it (e.g., require `amount == 1` or `amount == 0`). Otherwise, a caller passing `amount=500` sees success while only 1 token burns — misleading API.

**Fix**: Require `amount == 1` (or `amount == 0` with explicit notation that it's ignored) for NFTs, and reject other values, or remove `amount` from the `burn` signature for NFTs by overloading.

---

### m4. `freeze()`/`unfreeze()` take no parameters — which token? (lines 240–244) — **MINOR** (subsumed by B2)

Already covered by B2. If per-token model is chosen, these need `token_id` parameter.

---

### m5. Descriptor: `multi_token_mode` enum values not defined (line 265) — **MINOR**

Line 265: `multi_token_mode: enum // SINGLE | MULTI`

No numeric values. For a binary enum in a binary spec, define: `SINGLE = 0x00`, `MULTI = 0x01`.

---

### m6. Witness semantics underdefined for non-transfer entrypoints (line 283) — **MINOR**

Line 283: "For `mint`, `burn`, `approve`, and owner actions, witnesses correspond to standard authorization — the caller provides `signatures[i]` authorizing the state transition."

`mint` and `set_token_config` don't consume token UTXOs — they create or configure. What does `signatures[i]` index into? There's no `i`-th consumed token state. The witness model for these entrypoints needs explicit definition.

**Fix**: For mint-like entrypoints: "The caller provides a single signature authorizing the state transition, authenticated against the covenant owner's identity." For burn: "The caller provides a signature matching the consumed token state's `owner_id`." Define per-entrypoint authorization explicitly.

---

### m7. 64-byte metadata_uri embedded in every UTXO for fungible tokens (line 33) — **MINOR**

For fungible tokens with many holders, embedding the same 64-byte metadata URI in every holder's UTXO wastes ~64 bytes per UTXO. This is a design choice, not an error, but Sutton may flag it as inefficient compared to a metadata-registry approach.

**Mitigation**: Add a note acknowledging the tradeoff: "For fungible tokens, `metadata_uri` is replicated across all holder UTXOs. Implementations may optimize by using KCC-0021's registry to deduplicate, but the covenant state itself carries the canonical metadata_uri."

---

## KCC-0020 ALIGNMENT AUDIT (lines 287–303)

KCC-0008 claims to adopt 6 things from KCC-0020. Here's the honest assessment:

| Claim | Status | Notes |
|-------|--------|-------|
| Transfer interface (leader/delegator with `transfer(State[], Sig[], byte[])`) | **PARTIAL** | Signature omits `prevStates`. `Sig` vs `sig` type mismatch. |
| Positional I/O pairing | ✓ VALID | Index `i` → index `i` model works for both fungible and non-fungible. |
| Witness semantics (positional witness values) | ✓ VALID | `BORROWED_RECEIVE = 0xFF`, `STANDARD_TRANSFER = 0x00`. |
| Borrowed Receive (`0xFF` exempts auth, preserves state) | **PARTIAL** | Missing `identifierType` preservation. Missing KAS value constraint. Selectively lists preserved fields instead of "all non-amount state." |
| Extended state (blake2b digest) | ✓ VALID | Consistent with KCC-0020's extension model. |
| Descriptor (prefix/suffix bytes) | **PARTIAL** | Has prefix/suffix but missing `state_layout`, `leader_entrypoint_selector`, `delegator_entrypoint_selector`. |

**Honest KCC-0020 Alignment section should say**:
- ✓ Adopted: leader/delegator pattern, positional I/O, witness semantics, blake2b extended digest, prefix/suffix descriptor
- ⚠ Extended (diverges from KCC-0020): state header adds token_id, token_kind, flags, metadata_uri; no identifierType (see justification)
- ✗ Not adopted: identifierType-based owner resolution (KCC-0008 uses single bytes32 owner_id with implicit pubkey semantics)

---

## BYTE-LEVEL STATE LAYOUT VERIFICATION

The 146-byte layout arithmetic checks internally:

```
0       8       token_id        → bytes 0-7    ✓
8       1       token_kind      → byte 8       ✓
9       1       flags           → byte 9       ✓
10      32      owner_id        → bytes 10-41  ✓
42      8       amount          → bytes 42-49  ✓
50      64      metadata_uri    → bytes 50-113 ✓
114     32      extended_digest → bytes 114-145✓
```

Total: 146. Offsets are consecutive. No gaps. ✓

However: compared to KCC-0020's 34-byte header (`ownerIdentifier[32] + identifierType[1] + amount[?]`), this is a *completely different header*. The spec should not claim it "adopts" KCC-0020's state layout — it defines a superset that replaces KCC-0020's header.

---

## NFT MODEL ANALYSIS

**Can the unified model work?** Yes, structurally. Here's why:

1. **Fungible path**: token_kind=FUNGIBLE, amount varies, multiple UTXOs per token_id. Transfer splits/merges amounts across UTXOs. Positional I/O works: input[i].amount → output[i].amount, with sum conservation per token_id.

2. **Non-fungible path**: token_kind=NON_FUNGIBLE, amount=1 enforced, one UTXO per token_id. Transfer moves the single UTXO to a new owner. Positional I/O works: if Alice holds NFTs #1 and #2 (two UTXOs), she transfers #1→Bob, #2→Charlie in one transaction.

3. **Borrowed Receive for NFTs**: Doesn't apply (amount is always 1, can't increase). The spec doesn't address this — it should note that Borrowed Receive is irrelevant for NFTs.

4. **Mixed transfers**: Alice holds fungible token #0 (50 units) and NFT #1. She transfers 25 of #0 to Bob and #1 to Charlie. This is a single transaction with covenant inputs [token#0-UTXO, token#1-UTXO] → outputs [token#0-Bob(25)+change(25), token#1-Charlie]. Positional I/O handles this correctly.

**Verdict**: The unified model is coherent at the structural level. The gap is not in the model itself but in missing `identifierType` (for composability) and missing explicit documentation of NFT-specific transfer semantics (amount=1 invariant, one-UTXO-per-token_id enforcement, Borrowed Receive non-applicability).

---

## RULES ENFORCEABILITY

| Rule | Enforceable? | Issue |
|------|-------------|-------|
| 1. token_id unique and immutable | ✓ Yes | |
| 2. token_kind immutable | ✓ Yes | |
| 3. NFT amount == 1 | ✓ Yes | |
| 4. approve overwrites | ✓ Yes | |
| 5. transfer preserves sum per token_id | ✓ Yes | |
| 6. mint fails if total_supply + amount > max_supply | **⚠** | `max_supply` has no defined state location (M2) |
| 7. Royalty bps immutable | **⚠** | Royalty state has no defined location (M3) |
| 8. Freeze blocks state changes | **⚠** | Self-contradictory with unfreeze (B2) |
| 9. BIT_BURNED is terminal | ✓ Yes | |
| 10. Descriptor must be published | ✓ Yes | Social convention, not enforceable on-chain |

---

## MISSING SECTIONS

Compared to KCC-0020:

| Section | KCC-0020 | KCC-0008 | Status |
|---------|----------|----------|--------|
| Reader operation | Yes (detailed) | No | **Missing** |
| Writer operation | Yes (detailed with pseudocode) | No | **Missing** |
| Extension state rules | Yes | Partial (line 62 only) | **Incomplete** |
| Token state header with explicit type enums | Yes (`IDENTIFIER_PUBKEY=0x00`, etc.) | Partial (token_kind only, no owner types) | **Incomplete** |
| Reference implementation pseudocode | Yes (SilverScript sketches) | No | **Missing** |

---

## SUMMARY OF REQUIRED FIXES

### Must fix before submission (Blockers):
1. Add `identifierType` to state header (new offset 42 after owner_id, 1 byte)
2. Resolve freeze/unfreeze model contradiction (pick global or per-token; document)
3. Document how covenants hold KCC-0008 tokens via `identifierType = COVENANT_ID`

### Strongly recommended before submission (Majors):
4. Add `prevStates` to transfer signature or document divergence
5. Define token config extended state sub-layout (max_supply, mint_expiry_block)
6. Define royalty config extended state sub-layout (recipient_id, bps)
7. Add `state_layout`, `leader_entrypoint_selector`, `delegator_entrypoint_selector` to descriptor
8. Align parameter naming with KCC-0020 or document mapping
9. Remove or resolve dangling KCC-0001 reference
10. Remove or resolve dangling KCC-0021 reference
11. Add rule: divergent extended_digest for same token_id → transfer fails

### Nice to fix (Minors):
12. Clarify max_supply default (0 = uncapped before config)
13. Fix burn flags wording (bitwise OR, not assignment)
14. Validate or remove amount param for NFT burn
15. Define multi_token_mode enum values (0x00, 0x01)
16. Define per-entrypoint witness semantics for non-transfer entrypoints
17. Note metadata_uri replication tradeoff for fungible tokens

---

**Final assessment**: KCC-0008 is a 7/10 against the KCC-0020 bar. The conceptual architecture is sound, the multi-token unified model is genuinely innovative, and 13 dependent KCCs can build on it. But the three blockers — missing `identifierType`, undefined freeze model, and incomplete KCC-0020 alignment — would cause Sutton to reject it on first read. Fix those, and the spec survives scrutiny.