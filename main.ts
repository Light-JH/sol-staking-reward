import { Connection, PublicKey, GetVersionedTransactionConfig, ParsedTransactionWithMeta, LAMPORTS_PER_SOL } from '@solana/web3.js';

const JITO_TIP_DISTRIBUTION_PROGRAM = new PublicKey('4R3gSG8BpU4t19KYj8CfnbtRpnT8gtk4dvTHxVRwc2r7');

class CLI {
    address: string;

    constructor() {
        if (process.argv.length < 3) {
            throw new Error('Missing address argument');
        }
        this.address = process.argv[2];
    }
}

async function getTransactionHistory(pubkey: PublicKey) {
    const connection = new Connection('https://api.mainnet-beta.solana.com');
    const signatures = await connection.getConfirmedSignaturesForAddress2(pubkey, { limit: 10 }, 'finalized');
    return signatures.map(signature => signature.signature);
}

async function getTransactions(signatures: string[]) {
    const connection = new Connection('https://api.mainnet-beta.solana.com');
    const config: GetVersionedTransactionConfig = {
        commitment: 'finalized',
        maxSupportedTransactionVersion: 1
    };
    return ((await connection.getParsedTransactions(signatures, config)))
        .filter((value): value is ParsedTransactionWithMeta => value !== null);
}

class BalanceChange {
    blocktime: Date;
    slot: number;
    signature: string;
    balance_delta: number;

    // Constructor
    constructor(blocktime: Date, slot: number, signature: string, balance_delta: number) {
        this.blocktime = blocktime;
        this.slot = slot;
        this.signature = signature;
        this.balance_delta = balance_delta;
    }
}

function getBalanceChanges(pubkey: PublicKey, transactions: ParsedTransactionWithMeta[]): BalanceChange[] {

    const balanceChanges = [];
    for (const tx of transactions) {
        // we expect tip distribution is single instruction
        if (tx.transaction.message.instructions.length != 1) {
            continue
        }
        if (!tx.transaction.message.instructions[0].programId.equals(JITO_TIP_DISTRIBUTION_PROGRAM)) {
            continue;
        }
        const accountIndex = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey.equals(pubkey));
        if (accountIndex === -1) {
            continue
        }
        if (tx.meta?.err) { continue }
        let postBalances = tx.meta?.postBalances;
        let preBalances = tx.meta?.preBalances;
        if (!(postBalances && Array.isArray(postBalances)
            && preBalances && Array.isArray(preBalances))) {
            continue;
        }
        const balance_delta = postBalances[accountIndex] - preBalances[accountIndex];
        const blockTime = tx.blockTime;
        if (!blockTime) { console.log('missing blocktime'); continue }
        const balanceChange = new BalanceChange(new Date(blockTime * 1000), tx.slot, tx.transaction.signatures[0], balance_delta);
        balanceChanges.push(balanceChange);
    }
    return balanceChanges;
}

async function main(pubkey: PublicKey) {
    //  signature of each transaction tx = (message, signature ), UNIQUE identifier of the tx, use to query tx
    const signatures = await getTransactionHistory(pubkey);
    // get the actual tx
    const transactions = await getTransactions(signatures);
    const balanceChanges = getBalanceChanges(pubkey, transactions);
    console.log(balanceChanges);


    console.log('fetching from coinAPI...');
    const apiKey = process.env.API_KEY;
    const apiUrl = 'https://rest.coinapi.io/v1/ohlcv/COINBASE_SPOT_SOL_USD/history'
    for (var balanceChange of balanceChanges) {
        const time_start = balanceChange.blocktime;
        const args = {
            headers: { "X-CoinAPI-Key": apiKey },
            params: {
                "period_id": "15MIN",
                "limit": 1,
                "time_start": time_start,
            }
        };

        const response = await fetchData(apiUrl, args)
        if (!response) { throw new Error("failed to retrieve candle"); }
        if (response.length === 0) { throw new Error("no data for time"); }

        const data = response[0];
        const price = 0.25 * (data.price_open + data.price_close + data.price_high + data.price_low);
        const tmp: unknown = balanceChange.slot;
        const lamports = tmp as number;
        const value_in_usd = lamports * price / LAMPORTS_PER_SOL;

        const new_result = [
            balanceChange.balance_delta, balanceChange.blocktime, balanceChange.signature, balanceChange.slot,
            price,
            value_in_usd,
        ];
        console.log(new_result);
    }



    // return balanceChanges;
}

import axios from 'axios';
async function fetchData(url: string, headers: any) {
    try {
        const response = await axios.get(url, headers);
        return response.data;
    } catch (error) {
        console.error('Error fetching data:', error);
        return null;
    }
}

try {
    const cli = new CLI();
    const pubkey = new PublicKey(cli.address);
    main(pubkey).then(result => {
        console.log("success");


        // fetchData("https://rest.coinapi.io/v1/symbols", { headers: { " X-CoinAPI-Key": apiKey } }).then(data => {
        //     for (var symbol of data) {
        //         if (symbol.symbol_type !== 'SPOT') { continue; }
        //         if (!symbol.symbol_id.includes("SOL")) { continue; }
        //         if (!symbol.symbol_id.includes("USD")) { continue; }
        //         console.log(symbol);
        //     }
        // });


    })

} catch (error: any) {
    console.error(error.message);
}