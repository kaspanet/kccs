import { blake3 } from '@noble/hashes/blake3.js';
import { blake2b } from '@noble/hashes/blake2.js';

const hex = u => Buffer.from(u).toString('hex');
const fromHex = h => Uint8Array.from(Buffer.from(h, 'hex'));
const utf8 = s => new TextEncoder().encode(s);
const cat = (...a) => { const t=a.reduce((n,x)=>n+x.length,0); const o=new Uint8Array(t); let i=0; for(const x of a){o.set(x,i); i+=x.length;} return o; };
const le64 = n => { const b=new Uint8Array(8); let v=BigInt(n); for(let i=0;i<8;i++){b[i]=Number(v&0xffn); v>>=8n;} return b; };

// KCC-1 §5.3 int state payload: 8-byte LE signed-magnitude (sign in MSB of top byte)
const intState = n => { let v=BigInt(n); const neg=v<0n; if(neg)v=-v; const b=new Uint8Array(8);
  for(let i=0;i<8;i++){b[i]=Number(v&0xffn); v>>=8n;} if(neg) b[7]|=0x80; return b; };

// KCC-1 §5.2 PushExplicit: OP_0 if empty; 1..75 -> OP_DATA_n||b; 76..255 -> 0x4c len||b
const pushExplicit = b => { if(b.length===0) return new Uint8Array([0x00]);
  if(b.length<=75) return cat(new Uint8Array([b.length]), b);
  if(b.length<=255) return cat(new Uint8Array([0x4c, b.length]), b);
  throw new Error('vectors stay <=255B'); };

const dispatchTag = sig => blake3(utf8(sig)).slice(0,4);               // §6.1
const templateHash = (p, s) => blake3(cat(le64(p.length), p, le64(s.length), s)); // §8.3

// ---- SELF-VALIDATION against KCC-1 §11 published vectors ----
// These anchor the POSITIVE constructions below. The dispatch-tag construction is
// validated against BOTH a scalar signature (§11.1 step) AND a record-array
// signature (§11.1 dispense), so the record-array rendering used by `transfer` is
// reproduced from the spec's own anchor, not asserted.
const checks = [];
const eq = (name, got, want) => { const g=hex(got), ok=g===want; checks.push({name, ok}); if(!ok) throw new Error(`SELF-CHECK FAILED ${name}: got ${g} want ${want}`); };

eq('kcc1_11.1_dispatch_step', dispatchTag('step(int,byte[4],bool,byte)'), '2c49ed65');
eq('kcc1_11.1_dispatch_dispense_record_array', dispatchTag('dispense({byte[4],byte,bool}[])'), '676b1a86');
const s113 = cat(pushExplicit(new Uint8Array(32).fill(0x07)), pushExplicit(intState(-5)), pushExplicit(new Uint8Array([0x01])));
eq('kcc1_11.3_state', s113, '2007070707070707070707070707070707070707070707070707070707070707070805000000000000800101');
eq('kcc1_11.4_tmpl_empty', templateHash(new Uint8Array(), new Uint8Array()), 'e572dff82304700b856a555ac3a4558d0df3646a3727816500270a93c66aac1e');
eq('kcc1_11.4_tmpl_61_6263', templateHash(fromHex('61'), fromHex('6263')), '405e183e2494cdbe2df89349cc0ffa5b77fb885ad97a1d5660ecd0692ef8142a');
eq('kcc1_11.4_tmpl_6162_63', templateHash(fromHex('6162'), fromHex('63')), 'a0968c014f3fc7bd1a7d9a8d1ad1177eb379bd2f05e56309eb4e20347c5e7eba');

// ---- GENERATE KCC-20 vectors (spec shape: BLAKE3 + KCC20State) ----
// Field order per KCC-20 §1: amount, owner, owner_scheme, borrow_scheme, borrow_guard, extension_commitment.
const encKcc20State = st => cat(
  pushExplicit(intState(st.amount)),
  pushExplicit(fromHex(st.owner)),
  pushExplicit(new Uint8Array([st.owner_scheme])),
  pushExplicit(new Uint8Array([st.borrow_scheme])),
  pushExplicit(fromHex(st.borrow_guard)),
  pushExplicit(fromHex(st.extension_commitment)));

const B32 = h => h.padEnd(64,'0');
const stateVectors = [
  { name:'zero_amount_disabled_borrow', input:{amount:0, owner:B32('01'), owner_scheme:0, borrow_scheme:0, borrow_guard:B32(''), extension_commitment:B32('')} },
  { name:'amount_1000_p2pkh_amount_threshold_1000', input:{amount:1000, owner:B32('aa'), owner_scheme:1, borrow_scheme:1, borrow_guard:'e803000000000000'.padEnd(64,'0'), extension_commitment:B32('')} },
  { name:'large_amount_covenantid_owner_hashchain', input:{amount:Number(2n**53n-1n), owner:'ff'.repeat(32), owner_scheme:4, borrow_scheme:3, borrow_guard:'cd'.repeat(32), extension_commitment:'ee'.repeat(32)} },
].map(v => { const b=encKcc20State(v.input); return { ...v, expected_state_bytes_hex: hex(b), state_len_bytes: b.length }; });

const dispatchVectors = [
  { name:'transfer', function_signature:'transfer({int,byte[32],byte,byte,byte[32],byte[32]}[],byte[])' },
  { name:'transfer_delegator', function_signature:'transfer_delegator(byte[])' },
].map(v => ({ ...v, dispatch_tag_hex: hex(dispatchTag(v.function_signature)) }));

const tmplVectors = [
  { name:'toy_prefix51_suffix75', prefix_hex:'51', suffix_hex:'75' },
].map(v => ({ ...v, construction:'blake3(LE64(len(prefix))||prefix||LE64(len(suffix))||suffix)', template_hash_hex: hex(templateHash(fromHex(v.prefix_hex), fromHex(v.suffix_hex))) }));

// ---- REJECT VECTORS: inputs a conforming KCC-20 covenant MUST reject ----
// Unlike the constructions above, these assert validation behavior, so they have
// no KCC-1 §11 self-check anchor. Each cites the KCC-20 clause it enforces. Where a
// case is expressible at the state-encoding level, `successor_state_bytes_hex` gives
// the exact bytes a conforming transfer MUST refuse as a successor; the rest describe
// the transaction-level scenario in field values.
const encHex = st => hex(encKcc20State(st));
const rejectVectors = [
  { name:'negative_amount', category:'state', spec:'KCC-20 §1',
    reason:'amount must be non-negative.',
    successor_state_bytes_hex: encHex({amount:-1, owner:B32('01'), owner_scheme:0, borrow_scheme:0, borrow_guard:B32(''), extension_commitment:B32('')}) },

  { name:'unsupported_owner_scheme', category:'transfer', spec:'KCC-20 §2',
    reason:'The transfer must validate that every next_states[i].owner_scheme is supported; the default configuration supports 0x00-0x04, so 0xff is unsupported and would create an unspendable state.',
    successor_state_bytes_hex: encHex({amount:1, owner:B32('aa'), owner_scheme:0xff, borrow_scheme:0, borrow_guard:B32(''), extension_commitment:B32('')}) },

  { name:'invalid_witness_path_byte', category:'transfer', spec:'KCC-20 §2',
    reason:'witness[0] selects the path (0x00 normal, 0x01 borrowed); any other first byte is invalid.',
    scenario:{ witness_first_byte:'0x02' } },

  { name:'extension_commitment_not_preserved', category:'transfer', spec:'KCC-20 §2 / §4',
    reason:'All inputs and continuation outputs of a standard transfer must share the same extension_commitment, preserved unchanged.',
    scenario:{ input_extension_commitment:'ee'.repeat(32), successor_extension_commitment:'ff'.repeat(32) } },

  { name:'conservation_violated', category:'transfer', spec:'KCC-20 §2 / §5',
    reason:'The leader must preserve the total token amount across the covenant family.',
    scenario:{ total_input_amount:1000, total_output_amount:1001 } },

  { name:'exceeds_max_token_inputs', category:'transfer', spec:'KCC-20 §2 / §3',
    reason:'The transfer is bounded by max_token_inputs (3 in the default configuration).',
    scenario:{ max_token_inputs:3, token_inputs:4 } },

  { name:'borrow_when_disabled', category:'borrow', spec:'KCC-20 §5',
    reason:'disabled/v1 (0x00) rejects borrowing; a borrowed-receive path on such a leader is invalid.',
    scenario:{ leader_borrow_scheme:'0x00 disabled/v1', witness_first_byte:'0x01' } },

  { name:'borrow_increase_not_above_threshold', category:'borrow', spec:'KCC-20 §5',
    reason:'For amount-threshold/v1 the increase must be strictly greater than the threshold; an increase equal to the threshold is rejected.',
    scenario:{ borrow_scheme:'amount-threshold/v1', threshold:10, leader_amount:100, successor_amount:110 } },

  { name:'borrow_changes_owner', category:'borrow', spec:'KCC-20 §5',
    reason:'The borrowed successor must preserve owner, owner_scheme, borrow_scheme, and extension_commitment; a borrow that changes owner reassigns the balance with no owner authorization.',
    scenario:{ borrow_scheme:'amount-threshold/v1', threshold:0, leader_owner:'aa'.repeat(32), successor_owner:'bb'.repeat(32), leader_amount:100, successor_amount:200 } },

  { name:'borrow_reduces_kas_value', category:'borrow', spec:'KCC-20 §5',
    reason:'The output for next_states[0] must have at least the KAS value of the borrowed input.',
    scenario:{ borrowed_input_value_sompi:100000, successor_output_value_sompi:90000 } },

  { name:'hash_chain_guard_mismatch', category:'borrow', spec:'KCC-20 §5',
    reason:'For hash-chain/v1, require Hash(revealed_guard || one_time_pubkey) == borrow_guard.',
    scenario:{ note:'borrow_guard != BLAKE3(revealed_guard || one_time_pubkey)' } },
].map(v => ({ ...v, expected:'reject' }));

const out = {
  kcc: 20,
  title: 'KCC-20 conformance vectors (first cut)',
  producer: 'KRON — self-validated against KCC-1 §11',
  hash_function: 'unkeyed BLAKE3 32-byte (KCC-1 §3.1); P2SH envelope uses BLAKE2b',
  field_order: 'KCC-20 §1: amount, owner, owner_scheme, borrow_scheme, borrow_guard, extension_commitment',
  self_validation: { source:'KCC-1 §11', covers:'positive constructions (dispatch tags, state encoding, template hashes)', all_passed: checks.every(c=>c.ok), checks },
  state_encoding: stateVectors,
  dispatch_tags: dispatchVectors,
  template_hashes: tmplVectors,
  reject_vectors: rejectVectors,
  reject_vectors_note: 'Each reject vector cites the KCC-20 clause it enforces. They assert validation behavior and have no KCC-1 §11 anchor; a conforming covenant MUST reject each.',
};
console.log(JSON.stringify(out, null, 2));
