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
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const [copiedType, setCopiedType] = useState<'public' | 'private' | null>(null);

    const truncateKey = (key: string) => `${key.slice(0, 12)}...`;

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

    const copyToClipboard = async (text: string, index: number, type: 'public' | 'private') => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedIndex(index);
            setCopiedType(type);
            setTimeout(() => {
                setCopiedIndex(null);
                setCopiedType(null);
            }, 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    const isCopied = (index: number, type: 'public' | 'private') => {
        return copiedIndex === index && copiedType === type;
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
                        <div className="flex items-center space-x-2 mt-1">
                            <p className="font-mono text-white">{truncateKey(publicKey.toString())}</p>
                            <button
                                onClick={() => copyToClipboard(publicKey.toString(), -1, 'public')}
                                className="text-gray-400 hover:text-white transition-colors"
                                title="Copy parent public key"
                            >
                                {isCopied(-1, 'public') ? '✓' : '📋'}
                            </button>
                        </div>
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
                                                            <span>{truncateKey(wallet.publicKey)}</span>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    copyToClipboard(wallet.publicKey, wallet.index, 'public');
                                                                }}
                                                                className="text-gray-400 hover:text-white transition-colors"
                                                                title="Copy public key"
                                                            >
                                                                {isCopied(wallet.index, 'public') ? '✓' : '📋'}
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td 
                                                        className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-300 group"
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div 
                                                                onClick={() => toggleReveal(wallet.index)}
                                                                className="flex-1 cursor-pointer hover:bg-gray-600 transition-colors rounded px-2 py-1"
                                                            >
                                                                {wallet.isRevealed ? (
                                                                    <span className="truncate max-w-md">{wallet.privateKey}</span>
                                                                ) : (
                                                                    <div className="flex items-center space-x-2">
                                                                        <span className="text-gray-500">Click to reveal</span>
                                                                        <span className="text-gray-500 group-hover:text-white transition-colors">🔒</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    copyToClipboard(wallet.privateKey, wallet.index, 'private');
                                                                }}
                                                                className="text-gray-400 hover:text-white transition-colors ml-2"
                                                                title="Copy private key"
                                                            >
                                                                {isCopied(wallet.index, 'private') ? '✓' : '📋'}
                                                            </button>
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