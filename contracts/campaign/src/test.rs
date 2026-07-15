#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env, String, token,
};

fn setup_env<'a>() -> (Env, Address, Address, token::Client<'a>, token::StellarAssetClient<'a>, Address, CampaignContractClient<'a>) {
    let env = Env::default();
    env.mock_all_auths();

    // Set initial ledger state
    env.ledger().set(LedgerInfo {
        timestamp: 1000,
        protocol_version: 21,
        sequence_number: 1,
        network_id: [0; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 6312000,
    });

    let creator = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    // Register the Stellar Asset Contract
    let token_address = env.register_stellar_asset_contract_v2(token_admin).address();
    let token_client = token::Client::new(&env, &token_address);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_address);

    // Register campaign
    let campaign_id = env.register_contract(None, CampaignContract);
    let campaign_client = CampaignContractClient::new(&env, &campaign_id);

    (env, creator, token_address, token_client, token_admin_client, campaign_id, campaign_client)
}

#[test]
fn test_successful_pledge() {
    let (env, creator, token_address, token_client, token_admin, _, campaign_client) = setup_env();
    let contributor = Address::generate(&env);

    token_admin.mint(&contributor, &200);

    let title = String::from_str(&env, "StellarFund Campaign");
    let description = String::from_str(&env, "A hackathon project");
    
    campaign_client.initialize(&creator, &token_address, &100i128, &2000u64, &title, &description);

    campaign_client.pledge(&contributor, &40i128);

    assert_eq!(campaign_client.get_total_pledged(), 40i128);
    assert_eq!(campaign_client.get_contributor_amount(&contributor), 40i128);
    assert_eq!(token_client.balance(&campaign_client.address), 40i128);
    assert_eq!(token_client.balance(&contributor), 160i128);
    assert_eq!(campaign_client.get_status(), CampaignStatus::Active);
}

#[test]
fn test_withdraw_fails_if_goal_not_met() {
    let (env, creator, token_address, _, token_admin, _, campaign_client) = setup_env();
    let contributor = Address::generate(&env);

    token_admin.mint(&contributor, &200);

    let title = String::from_str(&env, "Campaign");
    let description = String::from_str(&env, "Desc");
    campaign_client.initialize(&creator, &token_address, &100i128, &2000u64, &title, &description);

    campaign_client.pledge(&contributor, &40i128);

    // Pass the deadline (2000) by setting timestamp to 2100
    env.ledger().set(LedgerInfo {
        timestamp: 2100,
        ..env.ledger().get()
    });

    assert_eq!(campaign_client.get_status(), CampaignStatus::Failed);

    let res = campaign_client.try_withdraw(&creator);
    assert!(res.is_err());
}

#[test]
fn test_withdraw_fails_if_deadline_not_passed() {
    let (env, creator, token_address, _, token_admin, _, campaign_client) = setup_env();
    let contributor = Address::generate(&env);

    token_admin.mint(&contributor, &200);

    let title = String::from_str(&env, "Campaign");
    let description = String::from_str(&env, "Desc");
    campaign_client.initialize(&creator, &token_address, &100i128, &2000u64, &title, &description);

    campaign_client.pledge(&contributor, &120i128);

    // Goal met, but timestamp is still 1000 (deadline 2000)
    assert_eq!(campaign_client.get_status(), CampaignStatus::Active);

    let res = campaign_client.try_withdraw(&creator);
    assert!(res.is_err());
}

#[test]
fn test_withdraw_succeeds_after_goal_met_and_deadline_passed() {
    let (env, creator, token_address, token_client, token_admin, _, campaign_client) = setup_env();
    let contributor = Address::generate(&env);

    token_admin.mint(&contributor, &200);

    let title = String::from_str(&env, "Campaign");
    let description = String::from_str(&env, "Desc");
    campaign_client.initialize(&creator, &token_address, &100i128, &2000u64, &title, &description);

    campaign_client.pledge(&contributor, &120i128);

    // Pass the deadline (2000)
    env.ledger().set(LedgerInfo {
        timestamp: 2100,
        ..env.ledger().get()
    });

    assert_eq!(campaign_client.get_status(), CampaignStatus::GoalMet);

    campaign_client.withdraw(&creator);

    assert_eq!(token_client.balance(&creator), 120i128);
    assert_eq!(token_client.balance(&campaign_client.address), 0i128);
    assert_eq!(campaign_client.get_status(), CampaignStatus::Withdrawn);
}

#[test]
fn test_refund_succeeds_when_goal_failed() {
    let (env, creator, token_address, token_client, token_admin, _, campaign_client) = setup_env();
    let contributor = Address::generate(&env);

    token_admin.mint(&contributor, &200);

    let title = String::from_str(&env, "Campaign");
    let description = String::from_str(&env, "Desc");
    campaign_client.initialize(&creator, &token_address, &100i128, &2000u64, &title, &description);

    campaign_client.pledge(&contributor, &40i128);

    // Pass the deadline (2000)
    env.ledger().set(LedgerInfo {
        timestamp: 2100,
        ..env.ledger().get()
    });

    campaign_client.claim_refund(&contributor);

    assert_eq!(token_client.balance(&contributor), 200i128);
    assert_eq!(token_client.balance(&campaign_client.address), 0i128);
    assert_eq!(campaign_client.get_contributor_amount(&contributor), 0i128);
}

#[test]
fn test_refund_fails_when_goal_was_met() {
    let (env, creator, token_address, _, token_admin, _, campaign_client) = setup_env();
    let contributor = Address::generate(&env);

    token_admin.mint(&contributor, &200);

    let title = String::from_str(&env, "Campaign");
    let description = String::from_str(&env, "Desc");
    campaign_client.initialize(&creator, &token_address, &100i128, &2000u64, &title, &description);

    campaign_client.pledge(&contributor, &120i128);

    // Pass the deadline (2000)
    env.ledger().set(LedgerInfo {
        timestamp: 2100,
        ..env.ledger().get()
    });

    let res = campaign_client.try_claim_refund(&contributor);
    assert!(res.is_err());
}

#[test]
fn test_unauthorized_withdraw_fails() {
    let (env, creator, token_address, _, token_admin, _, campaign_client) = setup_env();
    let contributor = Address::generate(&env);
    let random_user = Address::generate(&env);

    token_admin.mint(&contributor, &200);

    let title = String::from_str(&env, "Campaign");
    let description = String::from_str(&env, "Desc");
    campaign_client.initialize(&creator, &token_address, &100i128, &2000u64, &title, &description);

    campaign_client.pledge(&contributor, &120i128);

    // Pass the deadline (2000)
    env.ledger().set(LedgerInfo {
        timestamp: 2100,
        ..env.ledger().get()
    });

    // Try to withdraw with random_user address, which should fail with NotCreator
    let res = campaign_client.try_withdraw(&random_user);
    assert!(res.is_err());
}
