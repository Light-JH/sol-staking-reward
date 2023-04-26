import { Connection, PublicKey } from '@solana/web3.js';

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
    const signatures = await connection.getConfirmedSignaturesForAddress2(pubkey, { limit: 10 });
    for (const signature of signatures) {
        console.log(signature);
    }

}

try {
    const cli = new CLI();
    console.log(`The address saved is: ${cli.address}`);
    const pubkey = new PublicKey(cli.address);
    getTransactionHistory(pubkey).then(result => {
        console.log("success");
    })
} catch (error: any) {
    console.error(error.message);
}