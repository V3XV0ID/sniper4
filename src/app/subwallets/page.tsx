'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { FC, useState } from 'react';
import { Keypair } from '@solana/web3.js';
import { derivePath } from 'ed25519-hd-key';

const SubwalletsPage: FC = () => {
    const { publicKey, signMessage } = useWallet();
    const [subwallets, setSubwallets] = useState<Array<{ publicKey: string; index: number }>>([]);
    const [isGenerating, setIsGenerating] = useState(false);

    const generateSubwallets = async () => {
        if (!publicKey || !signMessage) return;

        setIsGenerating(true);
        try {
            // Sign a message to use as seed
            const message = new TextEncoder().encode('Generate HD Wallets');
            const signature = await signMessage(message);
            const signatureBytes = Buffer.from(signature).toString('hex');
            
            const newSubwallets = [];
            
            // Generate 100 HD wallets
            for (let i = 0; i < 100; i++) {
                const seedBuffer = derivePath(`m/44'/501'/${i}'`, signatureBytes).key;
                const keypair = Keypair.fromSeed(seedBuffer);
                newSubwallets.push({
                    publicKey: keypair.publicKey.toString(),
                    index: i
                });
            }
            
            setSubwallets(newSubwallets);
        } catch (error) {
            console.error('Error generating subwallets:', error);
        }
        setIsGenerating(false);
    };

    return (
        <div className="container mx-auto px-4 py-8">
            <h1 className="text-4xl font-bold mb-8">Subwallets Generator</h1>
            
            <div className="mb-8">
                <WalletMultiButton className="!bg-blue-600 hover:!bg-blue-700" />
            </div>

            {publicKey ? (
                <div className="space-y-6">
                    <div className="bg-gray-100 p-4 rounded-lg">
                        <p className="text-gray-700">Connected Wallet (Parent):</p>
                        <p className="font-mono break-all">{publicKey.toString()}</p>
                    </div>

                    <button
                        onClick={generateSubwallets}
                        disabled={isGenerating}
                        className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
                    >
                        {isGenerating ? 'Generating...' : 'Generate 100 Subwallets'}
                    </button>

                    {subwallets.length > 0 && (
                        <div className="mt-8">
                            <h2 className="text-2xl font-bold mb-4">Generated Subwallets</h2>
                            <div className="bg-white shadow rounded-lg overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Index</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Public Key</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {subwallets.map((wallet) => (
                                                <tr key={wallet.index}>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{wallet.index}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">{wallet.publicKey}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-center py-12">
                    <p className="text-xl text-gray-600">Please connect your Phantom wallet to continue</p>
                </div>
            )}
        </div>
    );
};

export default SubwalletsPage; 