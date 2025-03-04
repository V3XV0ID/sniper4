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
    const [loadingAction, setLoadingAction] = useState<'refreshing' | 'restoring' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pendingCa, setPendingCa] = useState<string>('');
    const [hasGeneratedWallets, setHasGeneratedWallets] = useState(false);

    useEffect(() => {
        setMounted(true);
        if (publicKey) {
            void loadFromLocalStorage();
        }
    }, [publicKey]);

    // Check for existing wallets when wallet connects
    useEffect(() => {
        if (publicKey) {
            const checkExistingWallets = async () => {
                try {
                    const storedData = localStorage.getItem('sniperfi_subwallets');
                    if (!storedData) return;

                    const parsed = JSON.parse(storedData) as {
                        parentWallet: string;
                        subwallets: Subwallet[];
                        timestamp: string;
                    };

                    // If we find wallets for this parent wallet
                    if (parsed.parentWallet === publicKey.toString()) {
                        setHasGeneratedWallets(true);
                        const loadedWallets = parsed.subwallets.map(wallet => ({
                            ...wallet,
                            isRevealed: false,
                            solBalance: 0,
                            caBalance: 0
                        }));
                        setSubwallets(loadedWallets);
                        // Fetch fresh balances
                        await fetchBalances(loadedWallets);
                    }
                } catch (error) {
                    console.error('Error checking existing wallets:', error);
                    setError('Failed to load existing wallets');
                    setTimeout(() => setError(null), 5000);
                }
            };

            void checkExistingWallets();
        } else {
            // Reset states when wallet disconnects
            setHasGeneratedWallets(false);
            setSubwallets([]);
        }
    }, [publicKey]);

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
        setLoadingAction('refreshing');
        setIsLoading(true);
        const updatedWallets = [...wallets];
        const batchSize = 5;
        
        try {
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
            
            setSubwallets([...updatedWallets]);
        } catch (error) {
            console.error('Error fetching balances:', error);
            setError('Failed to fetch balances');
            setTimeout(() => setError(null), 5000);
        } finally {
            setIsLoading(false);
            setLoadingAction(null);
        }
    };

    const saveToLocalStorage = (wallets: Subwallet[], parentAddress: string) => {
        try {
            const data = {
                parentWallet: parentAddress,
                subwallets: wallets,
                timestamp: new Date().toISOString()
            };
            localStorage.setItem('sniperfi_subwallets', JSON.stringify(data));
        } catch (error) {
            console.error('Error saving to local storage:', error);
        }
    };

    const loadFromLocalStorage = async () => {
        try {
            const data = localStorage.getItem('sniperfi_subwallets');
            if (!data || !publicKey) return;

            const parsed = JSON.parse(data) as {
                parentWallet: string;
                subwallets: Subwallet[];
                timestamp: string;
            };

            if (parsed.parentWallet === publicKey.toString()) {
                const loadedWallets = parsed.subwallets.map(wallet => ({
                    ...wallet,
                    isRevealed: false,
                    solBalance: 0,
                    caBalance: 0
                }));

                setSubwallets(loadedWallets);
                await fetchBalances(loadedWallets);
            }
        } catch (error) {
            console.error('Error loading from local storage:', error);
        }
    };

    const generateSubwallets = async () => {
        if (!publicKey || !signMessage || hasGeneratedWallets) {
            if (hasGeneratedWallets) {
                setError('Subwallets already generated for this wallet');
                setTimeout(() => setError(null), 5000);
            }
            return;
        }

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
            setHasGeneratedWallets(true);
            saveToLocalStorage(newSubwallets, publicKey.toString());
            await fetchBalances(newSubwallets);
        } catch (error) {
            console.error('Error generating subwallets:', error);
            setError('Failed to generate subwallets');
            setTimeout(() => setError(null), 5000);
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
        if (!file || !publicKey) return;

        setLoadingAction('restoring');
        setIsLoading(true);
        try {
            const fileContent = await file.text();
            const jsonData = JSON.parse(fileContent) as {
                parentWallet: string;
                subwallets: Subwallet[];
            };

            if (!jsonData.subwallets || !Array.isArray(jsonData.subwallets)) {
                throw new Error('Invalid wallet file format');
            }

            if (jsonData.parentWallet !== publicKey.toString()) {
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
            saveToLocalStorage(restoredWallets, publicKey.toString());
            await fetchBalances(restoredWallets);
        } catch (error) {
            console.error('Error restoring wallets:', error);
            setError('Failed to restore wallets: Invalid file format');
            setTimeout(() => setError(null), 5000);
        } finally {
            setIsLoading(false);
            setLoadingAction(null);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const refreshBalances = async () => {
        if (!publicKey || !subwallets.length || isLoading) return;
        
        setIsLoading(true);
        try {
            const connection = new Connection(
                'https://api.mainnet-beta.solana.com',
                'confirmed'
            );

            const updatedSubwallets = [...subwallets];
            
            // Fetch balances in batches to avoid rate limits
            for (let i = 0; i < updatedSubwallets.length; i++) {
                const wallet = updatedSubwallets[i];
                const address = new PublicKey(wallet.publicKey);
                
                // Get SOL balance
                const solBalance = await connection.getBalance(address);
                updatedSubwallets[i].solBalance = solBalance / LAMPORTS_PER_SOL;

                // Get CA balance if address is provided
                if (caAddress) {
                    try {
                        const tokenAddress = new PublicKey(caAddress);
                        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
                            address,
                            { mint: tokenAddress }
                        );
                        const balance = tokenAccounts.value[0]?.account.data.parsed.info.tokenAmount.uiAmount || 0;
                        updatedSubwallets[i].caBalance = balance;
                    } catch (err) {
                        console.error('Error fetching token balance:', err);
                        updatedSubwallets[i].caBalance = 0;
                    }
                }
            }

            setSubwallets(updatedSubwallets);
        } catch (error) {
            console.error('Error refreshing balances:', error);
            setError('Failed to refresh balances');
            setTimeout(() => setError(null), 5000);
        } finally {
            setIsLoading(false);
        }
    };

    if (!mounted) {
        return (
            <div className="min-h-screen bg-gray-900 text-white container mx-auto px-4 py-8">
                <h1 className="text-4xl font-bold mb-8 text-white">Loading...</h1>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-900 text-white container mx-auto px-4 py-8">
            <div className="flex flex-wrap items-center gap-4 mb-8">
                <WalletMultiButton />

                {publicKey && (
                    <div className="flex items-center space-x-4 flex-wrap gap-y-4">
                        {hasGeneratedWallets ? (
                            <>
                                <div className="bg-gray-800 px-4 py-2 rounded-lg">
                                    <p className="text-gray-300">
                                        Subwallets already generated
                                    </p>
                                </div>
                                <button
                                    onClick={downloadSubwallets}
                                    disabled={isLoading || !subwallets.length}
                                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                                >
                                    <span>Download Subwallets</span>
                                    <span>📥</span>
                                </button>
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isLoading}
                                    className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Restore Subwallets
                                </button>
                                <button
                                    onClick={() => void refreshBalances()}
                                    disabled={isLoading || !subwallets.length}
                                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                                >
                                    <span>Refresh Balances</span>
                                    <span>🔄</span>
                                </button>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={restoreSubwallets}
                                    className="hidden"
                                    accept=".json"
                                />
                            </>
                        ) : (
                            <button
                                onClick={generateSubwallets}
                                disabled={isLoading || isGenerating}
                                className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isGenerating ? 'Generating...' : 'Generate 100 Subwallets'}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {error && (
                <div className="bg-red-900/50 border border-red-500 text-red-100 px-4 py-2 rounded-lg mb-4">
                    {error}
                </div>
            )}

            {publicKey && (
                <div className="space-y-6">
                    <div className="bg-gray-800 rounded-lg p-4 mb-6">
                        <div className="flex items-center space-x-4">
                            <span className="text-gray-400">Parent Wallet</span>
                            <div className="flex items-center space-x-2">
                                <button
                                    onClick={() => void copyToClipboard(publicKey.toString(), -1, 'public')}
                                    className="text-gray-400 hover:text-white transition-colors"
                                    title="Copy public key"
                                >
                                    {isCopied(-1, 'public') ? '✓' : '📋'}
                                </button>
                                <span className="font-mono">{publicKey.toString()}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex space-x-4 items-center flex-wrap gap-y-4">
                        <div className="flex-1 flex space-x-2">
                            <input
                                type="text"
                                placeholder="Enter CA Address (optional)"
                                value={caAddress}
                                onChange={(e) => setCaAddress(e.target.value)}
                                onKeyPress={handleCaKeyPress}
                                className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
                            />
                            <button
                                onClick={() => handleCaSubmit()}
                                disabled={!caAddress.trim()}
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
                    </div>

                    {publicKey && subwallets.length === 0 && (
                        <div className="text-center py-6 bg-gray-800/50 rounded-lg mt-4">
                            <p className="text-gray-300">No subwallets found. Generate new ones or restore from a file.</p>
                        </div>
                    )}

                    {isLoading && (
                        <div className="text-center py-4">
                            <p className="text-gray-300">
                                {loadingAction === 'refreshing' ? 'Refreshing balances...' : 'Restoring wallets...'}
                            </p>
                        </div>
                    )}

                    {subwallets.length > 0 && (
                        <div className="mt-8">
                            <h2 className="text-2xl font-bold mb-4 text-white">Generated Subwallets</h2>
                            <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="border-b border-gray-700">
                                                <th className="py-3 px-4">INDEX</th>
                                                <th className="py-3 px-4">PUBLIC KEY</th>
                                                <th className="py-3 px-4" colSpan={2}>PRIVATE KEY</th>
                                                <th className="py-3 px-4">SOL BALANCE</th>
                                                <th className="py-3 px-4">CA BALANCE</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {subwallets.map((wallet, index) => (
                                                <tr key={index} className={index % 2 === 0 ? 'bg-gray-800' : ''}>
                                                    <td className="py-2 px-4">{index}</td>
                                                    <td className="py-2 px-4">
                                                        <div className="flex items-center space-x-2">
                                                            <button
                                                                onClick={() => void copyToClipboard(wallet.publicKey, index, 'public')}
                                                                className="text-gray-400 hover:text-white transition-colors"
                                                                title="Copy public key"
                                                            >
                                                                {isCopied(index, 'public') ? '✓' : '📋'}
                                                            </button>
                                                            <span className="font-mono">{truncateKey(wallet.publicKey)}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-2 pr-0 pl-4 w-10">
                                                        <button
                                                            onClick={() => void copyToClipboard(wallet.privateKey, index, 'private')}
                                                            className="text-gray-400 hover:text-white transition-colors"
                                                            title="Copy private key"
                                                        >
                                                            {isCopied(index, 'private') ? '✓' : '📋'}
                                                        </button>
                                                    </td>
                                                    <td className="py-2 pl-2 pr-4">
                                                        <div
                                                            onClick={() => toggleReveal(index)}
                                                            className="cursor-pointer font-mono"
                                                        >
                                                            {wallet.isRevealed ? wallet.privateKey : 'Click to reveal 🔒'}
                                                        </div>
                                                    </td>
                                                    <td className="py-2 px-4">{wallet.solBalance} SOL</td>
                                                    <td className="py-2 px-4">{wallet.caBalance}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default SubwalletsPage; 