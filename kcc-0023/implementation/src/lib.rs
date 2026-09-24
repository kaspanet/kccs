use kaspa_consensus_core::{hashing, tx::Transaction};
use kaspa_hashes::Hash;
use serde_json::{Map, Value};

pub struct Codec;

impl Codec {
    pub fn encode(json: &str) -> Option<Vec<u8>> {
        serde_json::from_str::<Map<String, Value>>(json).ok()?;
        let mut payload = Vec::with_capacity(json.len() + 1);
        payload.push(0);
        payload.extend_from_slice(json.as_bytes());
        Some(payload)
    }

    pub fn decode(payload: &[u8]) -> Option<&str> {
        if payload.first() != Some(&0) {
            return None;
        }
        let json = std::str::from_utf8(&payload[1..]).ok()?;
        serde_json::from_str::<Map<String, Value>>(json).ok()?;
        Some(json)
    }
}

pub struct Verifier;

impl Verifier {
    pub fn verify<'a>(
        preparation: &'a Transaction,
        genesis: &Transaction,
        expected_id: Hash,
    ) -> Option<&'a str> {
        if preparation.version != 1 || genesis.version < 1 {
            return None;
        }
        let metadata = Codec::decode(&preparation.payload)?;
        let preparation_id = hashing::tx::id_v1(preparation);

        for (input_index, input) in genesis.inputs.iter().enumerate() {
            let outpoint = input.previous_outpoint;
            if outpoint.transaction_id != preparation_id
                || preparation.outputs.get(outpoint.index as usize).is_none()
            {
                continue;
            }
            let Ok(authorizing_input) = u16::try_from(input_index) else {
                continue;
            };
            let group: Vec<_> = genesis
                .outputs
                .iter()
                .enumerate()
                .filter(|(_, output)| {
                    output.covenant.is_some_and(|binding| {
                        binding.authorizing_input == authorizing_input
                            && binding.covenant_id == expected_id
                    })
                })
                .map(|(index, output)| (index as u32, output))
                .collect();
            if !group.is_empty()
                && hashing::covenant_id::covenant_id(outpoint, group.into_iter()) == expected_id
            {
                return Some(metadata);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kaspa_consensus_core::{
        subnets::SUBNETWORK_ID_NATIVE,
        tx::{
            CovenantBinding, ScriptPublicKey, TransactionInput, TransactionOutpoint,
            TransactionOutput,
        },
    };
    use std::str::FromStr;

    #[test]
    fn declaration_vectors() {
        for payload in [b"\0{}".as_slice(), b"\0{\"name\":\"\xc3\xa9\"}".as_slice()] {
            let json = Codec::decode(payload).unwrap();
            assert_eq!(Codec::encode(json).as_deref(), Some(payload));
        }
        for payload in [
            b"{}".as_slice(),
            b"\x01{}".as_slice(),
            b"\0[]".as_slice(),
            b"\0{\"x\":\"\xff\"}".as_slice(),
            b"\0{}{}".as_slice(),
        ] {
            assert!(Codec::decode(payload).is_none());
        }
        assert!(Codec::encode("[]").is_none());
        assert!(Codec::encode("{}{}").is_none());
        assert_eq!(
            Codec::encode(" { \"b\": 2, \"a\": 1 } "),
            Some(b"\0 { \"b\": 2, \"a\": 1 } ".to_vec())
        );
    }

    #[test]
    fn binding_vector_and_mutations() {
        let payload =
            Codec::encode("{\"name\":\"Example Token\",\"symbol\":\"EXT\",\"decimals\":8}")
                .unwrap();
        let preparation = Transaction::new(
            1,
            vec![TransactionInput::new_with_compute_budget(
                TransactionOutpoint::new(Hash::from_bytes([0x11; 32]), 0),
                vec![],
                0,
                0,
            )],
            vec![TransactionOutput::new(
                100_000_000,
                ScriptPublicKey::from_vec(0, vec![0x51]),
            )],
            0,
            SUBNETWORK_ID_NATIVE,
            0,
            payload,
        );
        let preparation_id =
            Hash::from_str("206a0c31dbe45384b86de451a177fd7c8e986d278f2a86724d941937443113ef")
                .unwrap();
        let expected_covenant_id =
            Hash::from_str("c86366cec738e9a1578b2d871ee493dcaabfd79156810f13f3b62429859e394e")
                .unwrap();
        assert_eq!(hashing::tx::id_v1(&preparation), preparation_id);

        let mut genesis = Transaction::new(
            1,
            vec![TransactionInput::new_with_compute_budget(
                TransactionOutpoint::new(preparation_id, 0),
                vec![],
                0,
                0,
            )],
            vec![TransactionOutput::new(
                90_000_000,
                ScriptPublicKey::from_vec(0, vec![0x51]),
            )],
            0,
            SUBNETWORK_ID_NATIVE,
            0,
            vec![],
        );
        let covenant_id = hashing::covenant_id::covenant_id(
            genesis.inputs[0].previous_outpoint,
            [(0, &genesis.outputs[0])].into_iter(),
        );
        assert_eq!(covenant_id, expected_covenant_id);
        genesis.outputs[0].covenant = Some(CovenantBinding::new(0, covenant_id));
        genesis.finalize();
        assert_eq!(
            Verifier::verify(&preparation, &genesis, covenant_id),
            Codec::decode(&preparation.payload)
        );

        let mut changed = preparation.clone();
        let decimals = changed.payload.len() - 2;
        changed.payload[decimals] = b'9';
        assert!(Verifier::verify(&changed, &genesis, covenant_id).is_none());

        changed = preparation.clone();
        changed.version = 0;
        assert!(Verifier::verify(&changed, &genesis, covenant_id).is_none());

        let mut changed_genesis = genesis.clone();
        changed_genesis.inputs[0].previous_outpoint.index = 1;
        assert!(Verifier::verify(&preparation, &changed_genesis, covenant_id).is_none());

        changed_genesis = genesis.clone();
        changed_genesis
            .outputs
            .push(changed_genesis.outputs[0].clone());
        assert!(Verifier::verify(&preparation, &changed_genesis, covenant_id).is_none());

        changed_genesis = genesis.clone();
        changed_genesis.outputs[0].covenant = Some(CovenantBinding::new(1, covenant_id));
        assert!(Verifier::verify(&preparation, &changed_genesis, covenant_id).is_none());

        changed_genesis = genesis.clone();
        changed_genesis.version = 0;
        assert!(Verifier::verify(&preparation, &changed_genesis, covenant_id).is_none());

        let outpoint = TransactionOutpoint::new(preparation_id, 0);
        let mut multi = Transaction::new(
            1,
            vec![
                TransactionInput::new_with_compute_budget(
                    TransactionOutpoint::new(Hash::from_bytes([0x22; 32]), 0),
                    vec![],
                    0,
                    0,
                ),
                TransactionInput::new_with_compute_budget(outpoint, vec![], 0, 0),
            ],
            vec![
                TransactionOutput::new(1, ScriptPublicKey::from_vec(0, vec![0x51])),
                TransactionOutput::new(2, ScriptPublicKey::from_vec(0, vec![0x51])),
                TransactionOutput::new(3, ScriptPublicKey::from_vec(0, vec![0x51])),
            ],
            0,
            SUBNETWORK_ID_NATIVE,
            0,
            vec![],
        );
        let group_id = hashing::covenant_id::covenant_id(
            outpoint,
            [(0, &multi.outputs[0]), (2, &multi.outputs[2])].into_iter(),
        );
        multi.outputs[0].covenant = Some(CovenantBinding::new(1, group_id));
        multi.outputs[2].covenant = Some(CovenantBinding::new(1, group_id));
        multi.finalize();
        assert!(Verifier::verify(&preparation, &multi, group_id).is_some());
    }
}
