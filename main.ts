import { PublicKey } from '@solana/web3.js';

class CLI {
    address: string;

    constructor() {
        if (process.argv.length < 3) {
            throw new Error('Missing address argument');
        }
        this.address = process.argv[2];
    }
}

try {
    const cli = new CLI();
    console.log(`The address saved is: ${cli.address}`);
} catch (error: any) {
    console.error(error.message);
}