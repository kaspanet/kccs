# KCC Conformance Tracking — Based on kas-smiths.org Research

Last updated: 2026-07-25

## Items to Conform

### Naming

- [ ] **`next_states` vs `newStates`**: KCC-0020 uses `newStates`. Our specs use `next_states`. Decide: align or document divergence.
- [ ] **`Sig[]` vs `sig[]`**: KCC-0020 uses `sig[]`. Our specs use `Sig[]`. SilverScript type matters.
- [ ] **`kcc20_extensions` vs `optional_extensions`**: KCC-0020 descriptor uses `optional_extensions`. Our descriptor uses `kcc20_extensions`.
- [ ] **`owner_kind` vs `identifier_type`**: KCC-0002 (IzioDev) calls it `owner_kind`/control principal. We call it `identifier_type`. Same concept, different name.

### Structural

- [ ] **Transfer signature**: KCC-0020's SilverScript signature includes `prevStates` explicitly. Our declaration omits it. We have a note but the signature shape is different.
- [ ] **KCC-0002 cross-reference**: Our `identifierType` maps to IzioDev's control principal concept. Specs should acknowledge this.
- [ ] **Specs still say "see KCC-0020 for encoding"**: Many specs have a residual hand-wave. The Encoding sections now describe what KCC-0020 covers AND what's extended — but double-check all are honest.
- [ ] **Descriptor `state_layout`**: KCC-0020 requires it. KCC-0008 has it now. Verify all dependent specs include it.

### Ecosystem

- [ ] **KCC-0020 open questions**: Manyfest asked "How should the standard address mint, burn, freeze, and pause?" Our KCC-0008 answers this. Should we explicitly reference this in the PR description or KCC-0008 motivation?
- [ ] **kascov wallet**: Mainnet KCC20 transfers are live. Our specs should acknowledge the existing ecosystem.
- [ ] **No SilverScript implementation**: KCC-0020 ships with pseudocode. We have none. This is the biggest gap between us and KCC-0020.

### Commerce Conventions

- [ ] **Commerce fee covenant**: KCC-0010 is a token standard (Fee-on-Transfer), not a commerce fee convention. Commerce conventions reference a "protocol fee" but the bridge between KCC-0010 and commerce conventions isn't specified.
- [ ] **Agent commerce ecosystem**: Axiom (Andreas) has an agent commerce framework. Our commerce conventions (0019, 0022-0024) are complementary. Should we reference Axiom?
