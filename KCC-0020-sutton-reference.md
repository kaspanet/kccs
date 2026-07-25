# KCC-0020: Fungible Token Covenant Specification (Sutton Reference)
## Retrieved from kaspanet/kccs PR #2 (Manyfestation branch)

### State (NO byte offsets — interface level only)
```
owner_identifier:       bytes32
identifier_type:        byte
amount:                 integer
extended_state_digest:  bytes32
```

### Identifier Types
```
IDENTIFIER_PUBKEY       = 0x00
IDENTIFIER_SCRIPT_HASH  = 0x01
IDENTIFIER_COVENANT_ID  = 0x02
```

### Transfer Interface
```
transfer(State[] next_states, sig[] signatures, byte[] witnesses)
transfer_delegator()
```

### Descriptor
```
KCC20Descriptor {
    prefix: bytes
    suffix: bytes
    extended_state_layout: ExtendedStateLayout | none
    kcc20_extensions: ExtensionId[]
}
```

### Extended State
```
extended_state_digest = blake2b(encode(extended_state))
```

### Borrowed Receive Extension v1
```
BORROWED_RECEIVE = 0xFF
```
Strict positional pairing: borrowed input i -> successor state i
Required: owner_identifier unchanged, identifier_type unchanged, amount increases, extended_state_digest unchanged, KAS value preserved/increased.

### Key Observations
1. KCC-0020 is an INTERFACE spec — state has no byte offsets, no sizes, no endianness.
2. KCC-0020 has NO token_id, token_kind, flags, metadata_uri fields.
3. KCC-0020's state uses `owner_identifier` + `identifier_type`, NOT `owner_id` + `token_kind`.
4. Extended state digest is `extended_state_digest`, NOT `extended_digest`.
5. There is no `metadata_uri` anywhere in KCC-0020.
6. The descriptor has `extended_state_layout`, NOT token_ids list.