#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env};

#[contracttype]
enum Key {
    Token,
    Seller,
    Price,
}

/// A tiny shop for trying Wura's site connect on testnet. `init` once, then `buy`.
#[contract]
pub struct Shop;

#[contractimpl]
impl Shop {
    /// token = the USDC contract, price = USDC stroops (7 decimals) per unit.
    pub fn init(env: Env, token: Address, seller: Address, price: i128) {
        if env.storage().instance().has(&Key::Token) {
            panic!("already set up");
        }
        env.storage().instance().set(&Key::Token, &token);
        env.storage().instance().set(&Key::Seller, &seller);
        env.storage().instance().set(&Key::Price, &price);
    }

    /// Pays `qty` units in USDC to the seller.
    pub fn buy(env: Env, buyer: Address, qty: u32) {
        buyer.require_auth();
        if qty == 0 || qty > 100 {
            panic!("qty must be 1 to 100");
        }
        let token_id: Address = env.storage().instance().get(&Key::Token).unwrap();
        let seller: Address = env.storage().instance().get(&Key::Seller).unwrap();
        let price: i128 = env.storage().instance().get(&Key::Price).unwrap();
        token::Client::new(&env, &token_id).transfer(&buyer, &seller, &(price * qty as i128));
        env.events().publish((symbol_short!("bought"), buyer), qty);
    }
}
