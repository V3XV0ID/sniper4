'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { FC, useState } from 'react';
import { Keypair } from '@solana/web3.js';
import { derivePath } from 'ed25519-hd-key';

interface Subwallet {
    publicKey: string;
    privateKey: string;
    index: number;
    isRevealed: boolean;
}

const SubwalletsPage: FC = () => {
    const { publicKey, signMessage } = useWallet();
    const [subwallets, setSubwallets] = useState<Subwallet[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);

    const generateSubwallets = async () => {
        if (!publicKey || !signMessage) return;

        setIsGenerating(true);
        try {
            const message = new TextEncoder().encode('Generate HD Wallets');
            const signature = await signMessage(message);
            const signatureBytes = Buffer.from(signature).toString('hex');
            
            const newSubwallets = [];
            
            for (let i = 0; i < 100; i++) {
                const seedBuffer = derivePath(`m/44'/501'/${i}'`, signatureBytes).key;
                const keypair = Keypair.fromSeed(seedBuffer);
                newSubwallets.push({
                    publicKey: keypair.publicKey.toString(),
                    privateKey: Buffer.from(keypair.secretKey).toString('hex'),
                    index: i,
                    isRevealed: false
                });
            }
            
            setSubwallets(newSubwallets);
        } catch (error) {
            console.error('Error generating subwallets:', error);
        }
        setIsGenerating(false);
    };

    const toggleReveal = (index: number) => {
        setSubwallets(prev => prev.map(wallet => 
            wallet.index === index 
                ? { ...wallet, isRevealed: !wallet.isRevealed }
                : wallet
        ));
    };

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white container mx-auto px-4 py-8">
            <h1 className="text-4xl font-bold mb-8 text-white">Subwallets Generator</h1>
            
            <div className="mb-8">
                <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700" />
            </div>

            {publicKey ? (
                <div className="space-y-6">
                    <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                        <p className="text-gray-300">Connected Wallet (Parent):</p>
                        <p className="font-mono break-all text-white">{publicKey.toString()}</p>
                    </div>

                    <button
                        onClick={generateSubwallets}
                        disabled={isGenerating}
                        className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isGenerating ? 'Generating...' : 'Generate 100 Subwallets'}
                    </button>

                    {subwallets.length > 0 && (
                        <div className="mt-8">
                            <h2 className="text-2xl font-bold mb-4 text-white">Generated Subwallets</h2>
                            <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-700">
                                        <thead className="bg-gray-900">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Index</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Public Key</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Private Key</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-700">
                                            {subwallets.map((wallet) => (
                                                <tr key={wallet.index} className="hover:bg-gray-700">
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-300">
                                                        {wallet.index}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-300">
                                                        <div className="flex items-center space-x-2">
                                                            <span className="truncate max-w-md">{wallet.publicKey}</span>
                                                            <button
                                                                onClick={() => copyToClipboard(wallet.publicKey)}
                                                                className="text-gray-400 hover:text-white"
                                                                title="Copy public key"
                                                            >
                                                                📋
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-300">
                                                        <div className="flex items-center space-x-2">
                                                            <button
                                                                onClick={() => toggleReveal(wallet.index)}
                                                                className="text-gray-400 hover:text-white mr-2"
                                                                title={wallet.isRevealed ? "Hide private key" : "Reveal private key"}
                                                            >
                                                                {wallet.isRevealed ? '👁️' : '🔒'}
                                                            </button>
                                                            {wallet.isRevealed ? (
                                                                <>
                                                                    <span className="truncate max-w-md">{wallet.privateKey}</span>
                                                                    <button
                                                                        onClick={() => copyToClipboard(wallet.privateKey)}
                                                                        className="text-gray-400 hover:text-white"
                                                                        title="Copy private key"
                                                                    >
                                                                        📋
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <span className="text-gray-500">••••••••</span>
                                                            )}
                                                        </div>
                                                    </td>
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
                <div className="text-center py-12 bg-gray-800 rounded-lg">
                    <p className="text-xl text-gray-300">Please connect your Phantom wallet to continue</p>
                </div>
            )}
        </div>
    );
};

export default SubwalletsPage; 