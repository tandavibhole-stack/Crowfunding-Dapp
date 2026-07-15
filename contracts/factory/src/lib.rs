#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, Address, Env, Symbol, Vec, BytesN, Bytes, String,
    xdr::ToXdr,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    WasmHash,
    Token,
    Campaigns,
    Count,
}

#[contract]
pub struct FactoryContract;

#[contractimpl]
impl FactoryContract {
    pub fn init(env: Env, campaign_wasm_hash: BytesN<32>, token_address: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::WasmHash) {
            return Err(Error::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::WasmHash, &campaign_wasm_hash);
        env.storage().instance().set(&DataKey::Token, &token_address);
        env.storage().instance().set(&DataKey::Campaigns, &Vec::<Address>::new(&env));
        env.storage().instance().set(&DataKey::Count, &0u32);

        env.storage().instance().extend_ttl(50000, 100000);

        Ok(())
    }

    pub fn create_campaign(
        env: Env,
        creator: Address,
        goal: i128,
        deadline: u64,
        title: String,
        description: String,
    ) -> Result<Address, Error> {
        if !env.storage().instance().has(&DataKey::WasmHash) {
            return Err(Error::NotInitialized);
        }

        creator.require_auth();

        let count: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        
        // Generate unique deterministic salt using count and creator
        let mut salt_bin = Bytes::new(&env);
        salt_bin.append(&creator.clone().to_xdr(&env));
        salt_bin.append(&count.to_xdr(&env));
        let salt = env.crypto().sha256(&salt_bin);

        let wasm_hash: BytesN<32> = env.storage().instance().get(&DataKey::WasmHash).unwrap();
        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();

        // Deploy the new campaign contract instance
        let campaign_address = env.deployer().with_current_contract(salt).deploy(wasm_hash);

        // Call initialize on the new campaign contract
        let campaign_client = stellarfund_campaign::CampaignContractClient::new(&env, &campaign_address);
        campaign_client.initialize(&creator, &token_address, &goal, &deadline, &title, &description);

        // Store campaign in registry
        let mut campaigns: Vec<Address> = env.storage().instance().get(&DataKey::Campaigns).unwrap_or(Vec::new(&env));
        campaigns.push_back(campaign_address.clone());
        env.storage().instance().set(&DataKey::Campaigns, &campaigns);

        // Increment count
        env.storage().instance().set(&DataKey::Count, &(count + 1));
        env.storage().instance().extend_ttl(50000, 100000);

        // Emit factory event
        env.events().publish(
            (Symbol::new(&env, "campaign_deployed"), creator),
            (campaign_address.clone(), goal, deadline, env.ledger().timestamp()),
        );

        Ok(campaign_address)
    }

    pub fn list_campaigns(env: Env) -> Result<Vec<Address>, Error> {
        if !env.storage().instance().has(&DataKey::WasmHash) {
            return Err(Error::NotInitialized);
        }
        let campaigns: Vec<Address> = env.storage().instance().get(&DataKey::Campaigns).unwrap_or(Vec::new(&env));
        Ok(campaigns)
    }
}
