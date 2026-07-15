#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, Address, Env, Symbol, String, token,
};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum CampaignStatus {
    Active = 0,
    GoalMet = 1,
    Failed = 2,
    Withdrawn = 3,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    DeadlineNotPassed = 3,
    DeadlinePassed = 4,
    GoalNotMet = 5,
    GoalMet = 6,
    InvalidGoal = 7,
    InvalidDeadline = 8,
    NotCreator = 9,
    NoPledge = 10,
    AlreadyWithdrawn = 11,
    InvalidAmount = 12,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Creator,
    Token,
    Goal,
    Deadline,
    Title,
    Description,
    TotalPledged,
    Withdrawn,
    Contributor(Address),
}

#[contract]
pub struct CampaignContract;

#[contractimpl]
impl CampaignContract {
    pub fn initialize(
        env: Env,
        creator: Address,
        token: Address,
        goal: i128,
        deadline: u64,
        title: String,
        description: String,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Creator) {
            return Err(Error::AlreadyInitialized);
        }
        if goal <= 0 {
            return Err(Error::InvalidGoal);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::InvalidDeadline);
        }

        env.storage().instance().set(&DataKey::Creator, &creator);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Goal, &goal);
        env.storage().instance().set(&DataKey::Deadline, &deadline);
        env.storage().instance().set(&DataKey::Title, &title);
        env.storage().instance().set(&DataKey::Description, &description);
        env.storage().instance().set(&DataKey::TotalPledged, &0i128);
        env.storage().instance().set(&DataKey::Withdrawn, &false);

        // Extend instance storage TTL
        env.storage().instance().extend_ttl(50000, 100000);

        // Emit CampaignCreated event
        env.events().publish(
            (Symbol::new(&env, "campaign_created"), creator.clone()),
            (goal, deadline, title, description, env.ledger().timestamp()),
        );

        Ok(())
    }

    pub fn pledge(env: Env, contributor: Address, amount: i128) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Creator) {
            return Err(Error::NotInitialized);
        }

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        if env.ledger().timestamp() >= deadline {
            return Err(Error::DeadlinePassed);
        }

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        contributor.require_auth();

        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&contributor, &env.current_contract_address(), &amount);

        let key = DataKey::Contributor(contributor.clone());
        let current_pledged: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        let new_pledged = current_pledged + amount;
        env.storage().persistent().set(&key, &new_pledged);

        // Extend persistent storage TTL
        env.storage().persistent().extend_ttl(&key, 50000, 100000);

        let old_total: i128 = env.storage().instance().get(&DataKey::TotalPledged).unwrap_or(0);
        let new_total = old_total + amount;
        env.storage().instance().set(&DataKey::TotalPledged, &new_total);
        env.storage().instance().extend_ttl(50000, 100000);

        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();
        if old_total < goal && new_total >= goal {
            env.events().publish(
                (Symbol::new(&env, "goal_reached"),),
                (new_total, env.ledger().timestamp()),
            );
        }

        env.events().publish(
            (Symbol::new(&env, "pledge"), contributor),
            (amount, env.ledger().timestamp()),
        );

        Ok(())
    }

    pub fn withdraw(env: Env, creator: Address) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Creator) {
            return Err(Error::NotInitialized);
        }

        let stored_creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap();
        if creator != stored_creator {
            return Err(Error::NotCreator);
        }
        creator.require_auth();

        let withdrawn: bool = env.storage().instance().get(&DataKey::Withdrawn).unwrap_or(false);
        if withdrawn {
            return Err(Error::AlreadyWithdrawn);
        }

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        if env.ledger().timestamp() < deadline {
            return Err(Error::DeadlineNotPassed);
        }

        let total: i128 = env.storage().instance().get(&DataKey::TotalPledged).unwrap_or(0);
        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();
        if total < goal {
            return Err(Error::GoalNotMet);
        }

        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_address);
        let balance = token_client.balance(&env.current_contract_address());
        token_client.transfer(&env.current_contract_address(), &creator, &balance);

        env.storage().instance().set(&DataKey::Withdrawn, &true);
        env.storage().instance().extend_ttl(50000, 100000);

        env.events().publish(
            (Symbol::new(&env, "withdraw"), creator),
            (balance, env.ledger().timestamp()),
        );

        Ok(())
    }

    pub fn claim_refund(env: Env, contributor: Address) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Creator) {
            return Err(Error::NotInitialized);
        }

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        if env.ledger().timestamp() < deadline {
            return Err(Error::DeadlineNotPassed);
        }

        let total: i128 = env.storage().instance().get(&DataKey::TotalPledged).unwrap_or(0);
        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();
        if total >= goal {
            return Err(Error::GoalMet);
        }

        let key = DataKey::Contributor(contributor.clone());
        let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if amount <= 0 {
            return Err(Error::NoPledge);
        }

        contributor.require_auth();

        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &contributor, &amount);

        env.storage().persistent().set(&key, &0i128);

        env.events().publish(
            (Symbol::new(&env, "refund"), contributor),
            (amount, env.ledger().timestamp()),
        );

        Ok(())
    }

    pub fn get_status(env: Env) -> Result<CampaignStatus, Error> {
        if !env.storage().instance().has(&DataKey::Creator) {
            return Err(Error::NotInitialized);
        }

        let withdrawn: bool = env.storage().instance().get(&DataKey::Withdrawn).unwrap_or(false);
        if withdrawn {
            return Ok(CampaignStatus::Withdrawn);
        }

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        let total: i128 = env.storage().instance().get(&DataKey::TotalPledged).unwrap_or(0);
        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();

        if env.ledger().timestamp() < deadline {
            Ok(CampaignStatus::Active)
        } else if total >= goal {
            Ok(CampaignStatus::GoalMet)
        } else {
            Ok(CampaignStatus::Failed)
        }
    }

    pub fn get_total_pledged(env: Env) -> Result<i128, Error> {
        if !env.storage().instance().has(&DataKey::Creator) {
            return Err(Error::NotInitialized);
        }
        let total: i128 = env.storage().instance().get(&DataKey::TotalPledged).unwrap_or(0);
        Ok(total)
    }

    pub fn get_contributor_amount(env: Env, address: Address) -> Result<i128, Error> {
        if !env.storage().instance().has(&DataKey::Creator) {
            return Err(Error::NotInitialized);
        }
        let key = DataKey::Contributor(address);
        let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        Ok(amount)
    }

    pub fn get_creator(env: Env) -> Result<Address, Error> {
        if !env.storage().instance().has(&DataKey::Creator) {
            return Err(Error::NotInitialized);
        }
        let creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap();
        Ok(creator)
    }

    pub fn get_token(env: Env) -> Result<Address, Error> {
        if !env.storage().instance().has(&DataKey::Token) {
            return Err(Error::NotInitialized);
        }
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        Ok(token)
    }

    pub fn get_goal(env: Env) -> Result<i128, Error> {
        if !env.storage().instance().has(&DataKey::Goal) {
            return Err(Error::NotInitialized);
        }
        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();
        Ok(goal)
    }

    pub fn get_deadline(env: Env) -> Result<u64, Error> {
        if !env.storage().instance().has(&DataKey::Deadline) {
            return Err(Error::NotInitialized);
        }
        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        Ok(deadline)
    }

    pub fn get_title(env: Env) -> Result<String, Error> {
        if !env.storage().instance().has(&DataKey::Title) {
            return Err(Error::NotInitialized);
        }
        let title: String = env.storage().instance().get(&DataKey::Title).unwrap();
        Ok(title)
    }

    pub fn get_description(env: Env) -> Result<String, Error> {
        if !env.storage().instance().has(&DataKey::Description) {
            return Err(Error::NotInitialized);
        }
        let description: String = env.storage().instance().get(&DataKey::Description).unwrap();
        Ok(description)
    }
}

mod test;
