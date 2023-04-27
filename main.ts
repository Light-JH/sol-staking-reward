import { Connection, PublicKey, GetVersionedTransactionConfig } from '@solana/web3.js';

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

async function getTranctions(signatures: string[]) {
    const connection = new Connection('https://api.mainnet-beta.solana.com');
    const config: GetVersionedTransactionConfig = {
        commitment: 'finalized',
        maxSupportedTransactionVersion: 1
    };
    return await connection.getParsedTransactions(signatures, config);
}

async function main(pubkey: PublicKey) {
    const signatures = await getTransactionHistory(pubkey);
    const transactions = await getTranctions(signatures);
    for (const tx of transactions) {
        console.log(tx);
    }
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