#![no_std]
use soroban_sdk::{contract, contractevent, contractimpl, contracttype, token, Address, Env};

#[contracttype]
enum Key {
    Token,
    Seller,
    Price,
}

#[contractevent]
pub struct Bought {
    #[topic]
    pub buyer: Address,
    pub qty: u32,
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
        Bought { buyer, qty }.publish(&env);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, token::{StellarAssetClient, TokenClient}};

    fn setup() -> (Env, ShopClient<'static>, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let issuer = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(issuer).address();
        let seller = Address::generate(&env);
        let buyer = Address::generate(&env);
        StellarAssetClient::new(&env, &usdc).mint(&buyer, &100_0000000);
        let shop = ShopClient::new(&env, &env.register(Shop, ()));
        shop.init(&usdc, &seller, &20000000); // 2 USDC each
        (env, shop, usdc, seller, buyer)
    }

    #[test]
    fn buy_pays_the_seller_price_times_qty() {
        let (env, shop, usdc, seller, buyer) = setup();
        shop.buy(&buyer, &3);
        let t = TokenClient::new(&env, &usdc);
        assert_eq!(t.balance(&seller), 60000000);
        assert_eq!(t.balance(&buyer), 100_0000000 - 60000000);
    }

    #[test]
    #[should_panic(expected = "qty must be 1 to 100")]
    fn zero_qty_is_refused() {
        let (_e, shop, _u, _s, buyer) = setup();
        shop.buy(&buyer, &0);
    }

    #[test]
    #[should_panic(expected = "already set up")]
    fn init_only_once() {
        let (_e, shop, usdc, seller, _b) = setup();
        shop.init(&usdc, &seller, &1);
    }
}
