'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { FC, useState, useEffect, useRef, ChangeEvent, KeyboardEvent, FormEvent } from 'react';
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import { derivePath } from 'ed25519-hd-key';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import dynamic from 'next/dynamic';

// Dynamically import WalletMultiButton with ssr disabled
const WalletMultiButtonDynamic = dynamic(
    () => import('@solana/wallet-adapter-react-ui').then(mod => mod.WalletMultiButton),
    { ssr: false }
);

interface Subwallet {
    publicKey: string;
    privateKey: string;
    index: number;
    isRevealed: boolean;
    solBalance: number;
    caBalance: number;
}

const SubwalletsPage: FC = () => {
    const { publicKey, signMessage } = useWallet();
    const [mounted, setMounted] = useState(false);
    const [subwallets, setSubwallets] = useState<Subwallet[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const [copiedType, setCopiedType] = useState<'public' | 'private' | null>(null);
    const [connection] = useState(new Connection(clusterApiUrl('devnet'), 'confirmed'));
    const [caAddress, setCaAddress] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isRestoring, setIsRestoring] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pendingCa, setPendingCa] = useState<string>('');

    useEffect(() => {
        setMounted(true);
    }, []);

    const truncateKey = (key: string) => {
        if (key.length <= 8) return key;
        return `${key.slice(0, 4)}...${key.slice(-4)}`;
    };
    const formatBalance = (balance: number) => balance.toFixed(4);

    const fetchBalanceWithRetry = async (pubKey: string, retries = 3): Promise<number> => {
        for (let i = 0; i < retries; i++) {
            try {
                const balance = await connection.getBalance(new PublicKey(pubKey));
                return balance;
            } catch (error) {
                if (i === retries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
        return 0;
    };

    const fetchBalances = async (wallets: Subwallet[]) => {
        setIsLoading(true);
        setError(null);
        const updatedWallets = [...wallets];
        const batchSize = 5;
        
        for (let i = 0; i < updatedWallets.length; i += batchSize) {
            const batch = updatedWallets.slice(i, i + batchSize);
            await Promise.all(
                batch.map(async (wallet) => {
                    try {
                        const solBalance = await fetchBalanceWithRetry(wallet.publicKey);
                        wallet.solBalance = solBalance / LAMPORTS_PER_SOL;

                        if (caAddress) {
                            try {
                                const tokenAccount = await connection.getParsedTokenAccountsByOwner(
                                    new PublicKey(wallet.publicKey),
                                    { programId: TOKEN_PROGRAM_ID }
                                );
                                
                                const caAccountInfo = tokenAccount.value.find(
                                    (acc) => acc.account.data.parsed.info.mint === caAddress
                                );

                                wallet.caBalance = caAccountInfo 
                                    ? Number(caAccountInfo.account.data.parsed.info.tokenAmount.uiAmount)
                                    : 0;
                            } catch (error) {
                                console.warn(`Failed to fetch CA balance for wallet ${wallet.index}:`, error);
                                wallet.caBalance = 0;
                            }
                        }
                    } catch (error) {
                        console.warn(`Failed to fetch balances for wallet ${wallet.index}:`, error);
                        wallet.solBalance = 0;
                        wallet.caBalance = 0;
                    }
                })
            );
            
            // Update state after each batch
            setSubwallets([...updatedWallets]);
            
            // Add delay between batches to avoid rate limits
            if (i + batchSize < updatedWallets.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        setIsLoading(false);
    };

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
                    isRevealed: false,
                    solBalance: 0,
                    caBalance: 0
                });
            }
            
            setSubwallets(newSubwallets);
            await fetchBalances(newSubwallets);
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

    const downloadSubwallets = (): void => {
        if (!publicKey || !subwallets.length) return;

        const walletAddress = publicKey.toString();
        const truncatedAddress = `${walletAddress.slice(0, 4)}${walletAddress.slice(-4)}`;
        const fileName = `SNIPERFI_Subwallets_${truncatedAddress}.json`;

        const exportData = {
            parentWallet: publicKey.toString(),
            generatedAt: new Date().toISOString(),
            subwallets: subwallets.map(wallet => ({
                index: wallet.index,
                publicKey: wallet.publicKey,
                privateKey: wallet.privateKey,
                solBalance: wallet.solBalance,
                caBalance: wallet.caBalance
            }))
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleCaSubmit = async (e?: FormEvent): Promise<void> => {
        e?.preventDefault();
        if (!pendingCa.trim()) return;

        setCaAddress(pendingCa.trim());
        if (subwallets.length > 0) {
            await fetchBalances(subwallets);
        }
    };

    const handleCaKeyPress = (e: KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === 'Enter') {
            e.preventDefault();
            void handleCaSubmit();
        }
    };

    const restoreSubwallets = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsRestoring(true);
        try {
            const fileContent = await file.text();
            const jsonData = JSON.parse(fileContent) as {
                parentWallet: string;
                subwallets: Subwallet[];
            };

            // Validate the JSON structure
            if (!jsonData.subwallets || !Array.isArray(jsonData.subwallets)) {
                throw new Error('Invalid wallet file format');
            }

            // Validate parent wallet matches
            if (publicKey && jsonData.parentWallet !== publicKey.toString()) {
                setError('Warning: This file was generated with a different parent wallet');
                setTimeout(() => setError(null), 5000);
            }

            const restoredWallets = jsonData.subwallets.map(wallet => ({
                ...wallet,
                isRevealed: false,
                solBalance: 0,
                caBalance: 0
            }));

            setSubwallets(restoredWallets);
            // Fetch fresh balances for restored wallets
            await fetchBalances(restoredWallets);
        } catch (error) {
            console.error('Error restoring wallets:', error);
            setError('Failed to restore wallets: Invalid file format');
            setTimeout(() => setError(null), 5000);
        } finally {
            setIsRestoring(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = ''; // Reset file input
            }
        }
    };

    if (!mounted) {
        return (
            <div className="min-h-screen bg-gray-900 text-white container mx-auto px-4 py-8">
                <h1 className="text-4xl font-bold mb-8 text-white">Subwallets Generator</h1>
                <div className="mb-8">
                    <div className="!bg-purple-600 hover:!bg-purple-700 h-10 px-4 rounded cursor-wait">
                        Loading...
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-900 text-white container mx-auto px-4 py-8">
            <h1 className="text-4xl font-bold mb-8 text-white">Subwallets Generator</h1>
            
            <div className="mb-8">
                <WalletMultiButtonDynamic className="!bg-purple-600 hover:!bg-purple-700" />
            </div>

            {error && (
                <div className="bg-red-900/50 border border-red-500 text-red-100 px-4 py-2 rounded-lg mb-4">
                    {error}
                </div>
            )}

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

                    <div className="flex space-x-4 items-center flex-wrap gap-y-4">
                        <button
                            onClick={generateSubwallets}
                            disabled={isGenerating}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isGenerating ? 'Generating...' : 'Generate 100 Subwallets'}
                        </button>

                        {subwallets.length > 0 && (
                            <button
                                onClick={downloadSubwallets}
                                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded flex items-center space-x-2"
                            >
                                <span>Download Subwallets</span>
                                <span>📥</span>
                            </button>
                        )}

                        <div className="relative">
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={restoreSubwallets}
                                accept="application/json"
                                className="hidden"
                                id="restore-file"
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isRestoring}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <span>{isRestoring ? 'Restoring...' : 'Restore Subwallets'}</span>
                                <span>📤</span>
                            </button>
                        </div>

                        <div className="flex-1 flex space-x-2">
                            <input
                                type="text"
                                placeholder="Enter CA Address (optional)"
                                value={pendingCa}
                                onChange={(e) => setPendingCa(e.target.value)}
                                onKeyPress={handleCaKeyPress}
                                className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
                            />
                            <button
                                onClick={() => handleCaSubmit()}
                                disabled={!pendingCa.trim()}
                                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                            >
                                <span>Enter</span>
                                <span>↵</span>
                            </button>
                        </div>

                        {caAddress && (
                            <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 flex items-center justify-between">
                                <div>
                                    <p className="text-gray-300">Current CA Address:</p>
                                    <p className="font-mono text-white">{truncateKey(caAddress)}</p>
                                </div>
                                <button
                                    onClick={() => {
                                        setCaAddress('');
                                        setPendingCa('');
                                    }}
                                    className="text-gray-400 hover:text-white transition-colors"
                                    title="Clear CA Address"
                                >
                                    ✕
                                </button>
                            </div>
                        )}

                        {subwallets.length > 0 && (
                            <button
                                onClick={() => fetchBalances(subwallets)}
                                disabled={isLoading}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                                {isLoading ? 'Refreshing...' : 'Refresh Balances'}
                            </button>
                        )}
                    </div>

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
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">SOL Balance</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">CA Balance</th>
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
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                                        {formatBalance(wallet.solBalance)} SOL
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                                        {formatBalance(wallet.caBalance)}
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