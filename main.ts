import { Connection, PublicKey, GetVersionedTransactionConfig, ParsedTransactionWithMeta } from '@solana/web3.js';


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

function getBalanceChanges(pubkey: PublicKey, transactions: ParsedTransactionWithMeta[]) {
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
        balanceChanges.push([new Date(blockTime * 1000), tx.slot, tx.transaction.signatures[0], balance_delta]);
    }
    return balanceChanges;
}

async function main(pubkey: PublicKey) {
    const signatures = await getTransactionHistory(pubkey);
    const transactions = await getTransactions(signatures);
    const balanceChanges = getBalanceChanges(pubkey, transactions);
    console.log(balanceChanges)
}

try {
    const cli = new CLI();
    const pubkey = new PublicKey(cli.address);
    main(pubkey).then(result => {
        console.log("success");
    })
} catch (error: any) {
    console.error(error.message);
}