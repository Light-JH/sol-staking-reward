# sol-staking-reward
Simple tool to extract staking rewards in terms of USD

To run: `$ npx ts-node main.ts`
```text
Options:
  --version                Show version number                         [boolean]
  --address                Wallet address to get rewards for [string] [required]
  --latest-epoch           Specify the latest epoch          [number] [required]
  --jito-latest-signature  Specify the latest signature                 [string]
  --help                   Show help                                   [boolean]
```

## Inflation Rewards

`inflation_rewards.csv` stores the Solana native staking rewards i.e. inflation.
Inflation rewards are retrieved using Solana RPC calls; this will only search backwards from the current epoch until the `lastest_epoch` argument.

## Jito Rewards

`jito_rewards.csv` stores rewards from JITO staking i.e. tip distributions.
See https://jito-foundation.gitbook.io/mev/mev-payment-and-distribution/on-chain-addresses.

Jito rewards are retrieved by fetching transaction history of the `address` and filtering for successful transactions using the tip distribution program.
If provided, search will stop at the `jito_latest_signature`.

## USD Conversion

Solana RPC calls will return staking rewards in terms of SOL.
For tax purposes, we want to store the rewards in terms of USD at the time they were received; this is the current interpretation of US tax codes.
For conversion, this program uses [CoinAPI](https://www.coinapi.io/)'s data for the SOL USD spot market on coinbase. 
CoinAPI requires an API key.

This program accesses the api key via environment variable `COIN_API_KEY`.

## CSV Format

Both reward files have a shared csv format with headers:
```text
blocktime,slot,signature,balance_delta,value_in_usd,price,time_period_start,time_period_end
```

For inflation rewards, the `signature` column is the epoch number.
