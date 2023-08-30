import { Connection, PublicKey, GetVersionedTransactionConfig, ParsedTransactionWithMeta, LAMPORTS_PER_SOL, EpochSchedule } from '@solana/web3.js';
import { NumericLiteral } from 'typescript';
import axios from 'axios';
import * as fs from 'fs';
import { createObjectCsvWriter } from 'csv-writer';


// this is where the tips come from
const JITO_TIP_DISTRIBUTION_PROGRAM = new PublicKey('4R3gSG8BpU4t19KYj8CfnbtRpnT8gtk4dvTHxVRwc2r7');

class CLI {
    address: string;
    maxEpochInCsv: number;
    latestSignature: string | null;

    constructor() {
        if (process.argv.length < 4) {
            throw new Error('Missing address argument');
        }
        this.address = process.argv[2];
        this.maxEpochInCsv = parseInt(process.argv[3]);

        if (process.argv.length === 5) {
            this.latestSignature = process.argv[4];
        } else {
            this.latestSignature = null;
        }
    }
}

async function getTransactionHistory(pubkey: PublicKey, latestSignature: string | null) {
    const connection = new Connection('https://api.mainnet-beta.solana.com');
    // Create options object with or without the 'until' property
    const options = latestSignature
        ? { until: latestSignature }
        : undefined;
    const signatures = await connection.getConfirmedSignaturesForAddress2(pubkey, options, 'finalized');
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

async function getNewInflationRewards(pubkey: PublicKey, minEpoch: number) {
    const connection = new Connection('https://api.mainnet-beta.solana.com');
    // TODO: This only works if the stake account is active. Fix this.
    var epoch = (await connection.getEpochInfo()).epoch - 1;

    var rewards = [];
    while (true) {
        if (epoch <= minEpoch) { break; }
        console.log("retrieving epoch rewards for ", epoch);
        const reward = await connection.getInflationReward([pubkey], epoch);
        if (!reward) { break; }
        if (!reward[0]) { break; }
        const blockTime = await connection.getBlockTime(reward[0].effectiveSlot);
        if (!blockTime) { break; }
        const reward1 = new Reward(reward[0].amount, epoch, reward[0].effectiveSlot, blockTime)
        rewards.push(reward1);
        epoch -= 1;
    }

    return rewards;
}

function convertInflationRewards(inflationRewards: Reward[]): BalanceChange[] {
    return inflationRewards.map(reward => {
        return new BalanceChange(new Date(reward.blocktime * 1000), reward.effectiveSlot, reward.epoch.toString(), reward.amount);
    });
}

async function getJitoBalanceChanges(pubkey: PublicKey, latestSignature: string | null) {
    //  signature of each transaction tx = (message, signature ), UNIQUE identifier of the tx, use to query tx
    const signatures = await getTransactionHistory(pubkey, latestSignature);
    // get the actual tx
    const transactions = await getTransactions(signatures);
    return getBalanceChanges(pubkey, transactions);
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

async function fetchAndConvertToUSD(balanceChanges: BalanceChange[]) {
    console.log('fetching from coinAPI...');
    const apiKey = process.env.API_KEY;
    const apiUrl = 'https://rest.coinapi.io/v1/ohlcv/COINBASE_SPOT_SOL_USD/history'
    var balanceChangesUSD = [];
    for (var balanceChange of balanceChanges) {
        const time_start = balanceChange.blocktime;
        const args = {
            headers: { "X-CoinAPI-Key": apiKey },
            params: {
                "period_id": "1HRS",
                "time_start": time_start,
            }
        };

        const response = await fetchData(apiUrl, args)
        if (!response) { throw new Error("failed to retrieve candle"); }
        if (response.length === 0) { throw new Error("no data for time"); }

        const data = response[0]; // take the first candle
        const time_period_start = new Date(data.time_period_start);
        const time_period_end = new Date(data.time_period_end);
        const price = 0.25 * (data.price_open + data.price_close + data.price_high + data.price_low);
        const value_in_usd = balanceChange.balance_delta * price / LAMPORTS_PER_SOL;

        const balanceChangeUSD = new BalanceChangeUSD(balanceChange, time_period_start, time_period_end, price, value_in_usd)
        balanceChangesUSD.push(balanceChangeUSD);
    }

    return balanceChangesUSD;
}

async function fetchData(url: string, headers: any) {
    try {
        const response = await axios.get(url, headers);
        return response.data;
    } catch (error) {
        console.error('Error fetching data:', error);
        return null;
    }
}


class Reward {
    amount: number;
    epoch: number;
    effectiveSlot: number;
    blocktime: number;
    constructor(amount: number, epoch: number, effectiveSlot: number, blocktime: number) {
        this.amount = amount;
        this.epoch = epoch;
        this.effectiveSlot = effectiveSlot;
        this.blocktime = blocktime;
    }
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

class BalanceChangeUSD {
    blocktime: Date;
    slot: number;
    signature: string;
    balance_delta: number;
    value_in_usd: number;
    price: number;
    time_period_start: Date;
    time_period_end: Date;


    // Constructor
    constructor(balanceChange: BalanceChange, time_period_start: Date, time_period_end: Date, price: number, value_in_usd: number) {
        this.blocktime = balanceChange.blocktime;
        this.slot = balanceChange.slot;
        this.signature = balanceChange.signature;
        this.balance_delta = balanceChange.balance_delta;
        this.price = price;
        this.value_in_usd = value_in_usd;
        this.time_period_start = time_period_start;
        this.time_period_end = time_period_end;
    }
}

function writeBalanceChangesUSDToCsv(balanceChangesUSD: BalanceChangeUSD[], file_path: string) {
    // Define the CSV header and data
    const csvHeader = [
        { id: 'blocktime', title: 'blocktime' },
        { id: 'slot', title: 'slot' },
        { id: 'signature', title: 'signature' },
        { id: 'balance_delta', title: 'balance_delta' },
        { id: 'value_in_usd', title: 'value_in_usd' },
        { id: 'price', title: 'price' },
        { id: 'time_period_start', title: 'time_period_start' },
        { id: 'time_period_end', title: 'time_period_end' },
    ];

    const csvWriter = createObjectCsvWriter({
        path: file_path,
        header: csvHeader,
        append: fs.existsSync(file_path), // Set append to true to append data to the existing file
    });

    csvWriter.writeRecords(balanceChangesUSD)
        .then(() => {
            console.log('Reward appended to CSV file successfully');
        })
        .catch((error) => {
            console.error('Error appending reward to CSV file:', error);
        });
}

async function main(pubkey: PublicKey, maxEpochinfile: number, latestSignature: string | null) {
    const inflationRewards = await getNewInflationRewards(pubkey, maxEpochinfile);
    const inflationBalanceChanges = convertInflationRewards(inflationRewards);
    const inflationBalanceChangesUSD = await fetchAndConvertToUSD(inflationBalanceChanges);
    writeBalanceChangesUSDToCsv(inflationBalanceChangesUSD, 'inflation_rewards.csv');

    const jitoBalanceChanges = await getJitoBalanceChanges(pubkey, latestSignature);
    const jitoBalanceChangesUSD = await fetchAndConvertToUSD(jitoBalanceChanges);
    writeBalanceChangesUSDToCsv(jitoBalanceChangesUSD, 'jito_rewards.csv');
}

try {
    const cli = new CLI();
    const pubkey = new PublicKey(cli.address);
    main(pubkey, cli.maxEpochInCsv, cli.latestSignature).then(result => {
        console.log("success");
    })

} catch (error: any) {
    console.error(error.message);
}