#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Env, Address, BytesN};

fn setup() -> (Env, Address, Address, QuestXLMClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, QuestXLM);
    let client = QuestXLMClient::new(&env, &contract_id);
    let admin  = Address::generate(&env);
    let oracle = Address::generate(&env);
    client.initialize(&admin, &oracle);
    (env, admin, oracle, client)
}

#[test]
fn test_add_module_and_fund() {
    let (env, _admin, _oracle, client) = setup();
    let hash = BytesN::from_array(&env, &[0u8; 32]);
    let id = client.add_module(&hash, &1_000_000, &3600);
    assert_eq!(id, 0);
    client.fund_treasury(&10_000_000);
    assert_eq!(client.treasury_balance(), 10_000_000);
}

#[test]
fn test_full_completion_flow() {
    let (env, _admin, _oracle, client) = setup();
    let learner = Address::generate(&env);
    let module_hash = BytesN::from_array(&env, &[1u8; 32]);
    let answer_hash = BytesN::from_array(&env, &[2u8; 32]);

    client.add_module(&module_hash, &1_000_000, &3600);
    client.fund_treasury(&10_000_000);
    client.approve_answer(&0, &answer_hash);
    client.submit_completion(&learner, &0, &answer_hash);

    assert_eq!(client.treasury_balance(), 9_000_000);
    let stats = client.learner_stats(&learner);
    assert_eq!(stats.len(), 1);
}

#[test]
fn test_cooldown_enforced() {
    let (env, _admin, _oracle, client) = setup();
    let learner = Address::generate(&env);
    let module_hash = BytesN::from_array(&env, &[1u8; 32]);
    let answer_hash = BytesN::from_array(&env, &[2u8; 32]);

    client.add_module(&module_hash, &1_000_000, &3600);
    client.fund_treasury(&10_000_000);
    client.approve_answer(&0, &answer_hash);
    client.submit_completion(&learner, &0, &answer_hash);

    // second attempt without advancing time should fail
    let answer_hash2 = BytesN::from_array(&env, &[3u8; 32]);
    client.approve_answer(&0, &answer_hash2);
    let result = client.try_submit_completion(&learner, &0, &answer_hash2);
    assert!(result.is_err());
}

#[test]
fn test_wrong_answer_rejected() {
    let (env, _admin, _oracle, client) = setup();
    let learner = Address::generate(&env);
    let module_hash = BytesN::from_array(&env, &[1u8; 32]);
    let bad_hash   = BytesN::from_array(&env, &[9u8; 32]);

    client.add_module(&module_hash, &1_000_000, &3600);
    client.fund_treasury(&10_000_000);

    let result = client.try_submit_completion(&learner, &0, &bad_hash);
    assert!(result.is_err());
}
