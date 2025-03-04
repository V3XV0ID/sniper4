'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { FC, useState, useEffect, useRef, ChangeEvent, KeyboardEvent, FormEvent } from 'react';
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL, clusterApiUrl, Transaction, SystemProgram } from '@solana/web3.js';
import { derivePath } from 'ed25519-hd-key';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import dynamic from 'next/dynamic';
import { ActionModal, ActionType } from '@/components/ActionModal';
import { FundModal } from '@/components/modals/FundModal';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useConnection } from '@solana/wallet-adapter-react';

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
    isLoading?: boolean;
}

interface FundingProgress {
    stage: 'preparing' | 'processing' | 'confirming' | 'complete';
    currentBatch: number;
    totalBatches: number;
    processedWallets: number;
    totalWallets: number;
    error?: string;
}

const SubwalletsPage: FC = () => {
    const { publicKey, signMessage, sendTransaction } = useWallet();
    const { connection } = useConnection();
    const [mounted, setMounted] = useState(false);
    const [subwallets, setSubwallets] = useState<Subwallet[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const [copiedType, setCopiedType] = useState<'public' | 'private' | null>(null);
    const [caAddress, setCaAddress] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [loadingAction, setLoadingAction] = useState<'refreshing' | 'restoring' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pendingCa, setPendingCa] = useState<string>('');
    const [hasGeneratedWallets, setHasGeneratedWallets] = useState(false);
    const [modalType, setModalType] = useState<'fund' | 'recoverSol' | 'recoverCA' | null>(null);
    const [progress, setProgress] = useState<FundingProgress>({
        stage: 'preparing',
        currentBatch: 0,
        totalBatches: 0,
        processedWallets: 0,
        totalWallets: 0
    });
    const [isProcessing, setIsProcessing] = useState(false);

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

    // Auto-hide loading after a brief moment
    useEffect(() => {
        const timer = setTimeout(() => {
            setIsLoading(false);
        }, 500); // Half second loading state max

        return () => clearTimeout(timer);
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
        if (!publicKey || !subwallets.length) return;
        
        setIsLoading(true);
        setLoadingAction('refreshing');
        setError(null);

        try {
            const connection = new Connection(
                'https://api.mainnet-beta.solana.com',
                'confirmed'
            );

            const updatedSubwallets = subwallets.map(wallet => ({
                ...wallet,
                isLoading: true,
                solBalance: '...',
                caBalance: caAddress ? '...' : '0'
            }));
            setSubwallets(updatedSubwallets);

            // Process in parallel with individual loading states
            await Promise.all(
                updatedSubwallets.map(async (wallet, index) => {
                    try {
                        const solBalance = await connection.getBalance(
                            new PublicKey(wallet.publicKey)
                        );
                        
                        // Update individual wallet
                        setSubwallets(current => {
                            const updated = [...current];
                            updated[index] = {
                                ...updated[index],
                                solBalance: (solBalance / LAMPORTS_PER_SOL).toFixed(4),
                                isLoading: caAddress ? true : false // Keep loading if fetching CA
                            };
                            return updated;
                        });

                        if (caAddress) {
                            const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
                                new PublicKey(wallet.publicKey),
                                { mint: new PublicKey(caAddress) }
                            );
                            
                            // Update CA balance
                            setSubwallets(current => {
                                const updated = [...current];
                                updated[index] = {
                                    ...updated[index],
                                    caBalance: (tokenAccounts.value[0]?.account.data.parsed.info.tokenAmount.uiAmount || 0).toString(),
                                    isLoading: false
                                };
                                return updated;
                            });
                        }
                    } catch (err) {
                        console.error(`Error fetching balance for wallet ${index}:`, err);
                        setSubwallets(current => {
                            const updated = [...current];
                            updated[index] = {
                                ...updated[index],
                                solBalance: 'Error',
                                caBalance: 'Error',
                                isLoading: false
                            };
                            return updated;
                        });
                    }
                })
            );
        } catch (err) {
            console.error('Error refreshing balances:', err);
            setError('Failed to refresh balances. Please try again.');
        } finally {
            setIsLoading(false);
            setLoadingAction(null);
        }
    };

    const formatPrivateKey = (key: string) => {
        const first4 = key.slice(0, 4);
        const last4 = key.slice(-4);
        return `${first4}...${last4}`;
    };

    const handleFundSubwallets = async (params: {
        totalBudget: number;
        walletsToFund: number;
        isRandom: boolean;
        minAmount?: number;
        maxAmount?: number;
    }) => {
        const [progress, setProgress] = useState<FundingProgress>({
            stage: 'preparing',
            currentBatch: 0,
            totalBatches: 0,
            processedWallets: 0,
            totalWallets: 0
        });
        const [isProcessing, setIsProcessing] = useState(false);

        try {
            if (!publicKey || !subwallets.length) {
                throw new Error('Wallet not connected or no subwallets available');
            }

            setIsProcessing(true);
            setProgress({
                stage: 'preparing',
                currentBatch: 0,
                totalBatches: 0,
                processedWallets: 0,
                totalWallets: params.walletsToFund
            });

            // Validate total budget
            const balance = await connection.getBalance(publicKey);
            const totalSol = params.totalBudget;
            if (balance < totalSol * LAMPORTS_PER_SOL) {
                throw new Error(`Insufficient balance. Need ${totalSol} SOL but wallet has ${balance / LAMPORTS_PER_SOL} SOL`);
            }

            // Calculate amounts
            let amounts: number[] = [];
            try {
                if (params.isRandom) {
                    if (params.minAmount! * params.walletsToFund > params.totalBudget) {
                        throw new Error('Total budget too low for minimum amounts');
                    }
                    if (params.minAmount! > params.maxAmount!) {
                        throw new Error('Minimum amount cannot be greater than maximum amount');
                    }

                    let remaining = params.totalBudget;
                    for (let i = 0; i < params.walletsToFund - 1; i++) {
                        const max = Math.min(
                            params.maxAmount!,
                            remaining - (params.minAmount! * (params.walletsToFund - i - 1))
                        );
                        const amount = params.minAmount! + Math.random() * (max - params.minAmount!);
                        amounts.push(Number(amount.toFixed(4)));
                        remaining -= amount;
                    }
                    amounts.push(Number(remaining.toFixed(4)));
                } else {
                    const amount = params.totalBudget / params.walletsToFund;
                    amounts = Array(params.walletsToFund).fill(Number(amount.toFixed(4)));
                }
            } catch (error) {
                throw new Error(`Failed to calculate distribution: ${error.message}`);
            }

            // Process in batches
            const BATCH_SIZE = 2;
            const walletsToFund = subwallets.slice(0, params.walletsToFund);
            const totalBatches = Math.ceil(walletsToFund.length / BATCH_SIZE);

            setProgress(prev => ({
                ...prev,
                stage: 'processing',
                totalBatches
            }));

            for (let i = 0; i < walletsToFund.length; i += BATCH_SIZE) {
                try {
                    const batch = walletsToFund.slice(i, i + BATCH_SIZE);
                    const batchAmounts = amounts.slice(i, i + BATCH_SIZE);
                    
                    setProgress(prev => ({
                        ...prev,
                        currentBatch: Math.floor(i / BATCH_SIZE) + 1,
                        processedWallets: i
                    }));

                    const transaction = new Transaction();
                    
                    batch.forEach((wallet, index) => {
                        transaction.add(
                            SystemProgram.transfer({
                                fromPubkey: publicKey,
                                toPubkey: new PublicKey(wallet.publicKey),
                                lamports: batchAmounts[index] * LAMPORTS_PER_SOL
                            })
                        );
                    });

                    // Get latest blockhash with retry
                    let latestBlockhash;
                    for (let retry = 0; retry < 3; retry++) {
                        try {
                            latestBlockhash = await connection.getLatestBlockhash('confirmed');
                            break;
                        } catch (error) {
                            if (retry === 2) throw error;
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    }

                    transaction.recentBlockhash = latestBlockhash.blockhash;
                    transaction.feePayer = publicKey;

                    setProgress(prev => ({ ...prev, stage: 'confirming' }));

                    // Send and confirm with timeout
                    const signature = await Promise.race([
                        sendTransaction(transaction, connection),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Transaction timeout')), 30000)
                        )
                    ]);

                    // Wait for confirmation with progress updates
                    let confirmed = false;
                    for (let attempt = 0; attempt < 30 && !confirmed; attempt++) {
                        const confirmation = await connection.getSignatureStatus(signature);
                        if (confirmation.value?.confirmationStatus === 'confirmed') {
                            confirmed = true;
                        } else {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    }

                    if (!confirmed) {
                        throw new Error('Transaction confirmation timeout');
                    }

                    // Update balances
                    setSubwallets(current => {
                        const updated = [...current];
                        batch.forEach((wallet, index) => {
                            const walletIndex = subwallets.findIndex(w => w.publicKey === wallet.publicKey);
                            if (walletIndex !== -1) {
                                updated[walletIndex] = {
                                    ...updated[walletIndex],
                                    solBalance: (parseFloat(updated[walletIndex].solBalance || '0') + batchAmounts[index]).toFixed(4)
                                };
                            }
                        });
                        return updated;
                    });

                    setProgress(prev => ({
                        ...prev,
                        processedWallets: i + batch.length
                    }));

                    // Delay between batches
                    if (i + BATCH_SIZE < walletsToFund.length) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (error) {
                    throw new Error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${error.message}`);
                }
            }

            setProgress(prev => ({ ...prev, stage: 'complete' }));
            setTimeout(() => setModalType(null), 2000);

        } catch (error) {
            console.error('Funding failed:', error);
            setProgress(prev => ({ ...prev, error: error.message }));
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRecoverSol = async () => {
        // Implementation coming soon
        console.log('Recovering SOL');
    };

    const handleRecoverCA = async () => {
        // Implementation coming soon
        console.log('Recovering CA tokens');
    };

    const handleSellAll = async () => {
        // Implementation coming soon
        console.log('Selling all tokens');
    };

    if (!mounted) {
        return (
            <div className="min-h-screen bg-gray-900 text-white container mx-auto px-4 py-8">
                <h1 className="text-4xl font-bold mb-8 text-white">Loading...</h1>
            </div>
        );
    }

    if (isLoading) {
        return <LoadingSpinner />;
    }

    return (
        <div className="min-h-screen bg-gray-900 text-white container mx-auto px-4 py-8">
            <div className="flex flex-wrap items-center gap-4 mb-8">
                <WalletMultiButton className="h-10" />
                {publicKey && (
                    <div className="flex items-center space-x-4 flex-wrap gap-y-4">
                        {hasGeneratedWallets ? (
                            <>
                                <div className="bg-gray-800 px-4 h-10 flex items-center rounded-lg">
                                    <p className="text-gray-300">
                                        Subwallets already generated
                                    </p>
                                </div>
                                <button
                                    onClick={downloadSubwallets}
                                    disabled={isLoading || !subwallets.length}
                                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 h-10 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                                >
                                    <span>Download Subwallets</span>
                                    <span>📥</span>
                                </button>
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isLoading}
                                    className="bg-purple-600 hover:bg-purple-700 text-white font-bold px-4 h-10 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Restore Subwallets
                                </button>
                                <button
                                    onClick={() => void refreshBalances()}
                                    disabled={isLoading || !subwallets.length}
                                    className="bg-green-600 hover:bg-green-700 text-white font-bold px-4 h-10 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
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
                                className="bg-green-600 hover:bg-green-700 text-white font-bold px-4 h-10 rounded disabled:opacity-50 disabled:cursor-not-allowed"
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
                <div className="flex gap-4 mb-8">
                    <div className="bg-gray-800 rounded-lg w-1/2 h-10 flex items-center px-4">
                        <span className="text-gray-400 mr-4">Parent Wallet</span>
                        <div className="flex items-center space-x-2 overflow-hidden">
                            <button
                                onClick={() => void copyToClipboard(publicKey.toString(), -1, 'public')}
                                className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
                                title="Copy public key"
                            >
                                {isCopied(-1, 'public') ? '✓' : '📋'}
                            </button>
                            <span className="font-mono truncate">{publicKey.toString()}</span>
                        </div>
                    </div>

                    <div className="flex flex-1 gap-4">
                        <input
                            type="text"
                            placeholder="Enter CA Address (optional)"
                            value={caAddress}
                            onChange={(e) => setCaAddress(e.target.value)}
                            className="flex-1 bg-gray-800 text-white px-4 h-10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                            onClick={() => setCaAddress('')}
                            className="bg-purple-600 hover:bg-purple-700 text-white font-bold px-4 h-10 rounded"
                        >
                            Enter ↵
                        </button>
                    </div>
                </div>
            )}

            {publicKey && hasGeneratedWallets && (
                <div className="flex gap-4 mb-8">
                    <button
                        onClick={() => setModalType('fund')}
                        className="bg-yellow-600 px-4 py-2 h-10 rounded hover:bg-yellow-500 transition-colors disabled:opacity-50"
                        disabled={isLoading || !subwallets.length}
                    >
                        Fund Subwallets with SOL 💰
                    </button>
                    
                    <button
                        onClick={() => setModalType('recoverSol')}
                        className="bg-orange-600 px-4 py-2 h-10 rounded hover:bg-orange-500 transition-colors disabled:opacity-50"
                        disabled={isLoading || !subwallets.length}
                    >
                        Recover SOL from Subwallets 🔄
                    </button>
                    
                    <button
                        onClick={() => setModalType('recoverCA')}
                        className="bg-red-600 px-4 py-2 h-10 rounded hover:bg-red-500 transition-colors disabled:opacity-50"
                        disabled={isLoading || !subwallets.length || !caAddress}
                    >
                        Recover CA tokens from Subwallets 🔄
                    </button>
                    
                    <button
                        onClick={() => setModalType('sellAll')}
                        className="bg-pink-600 px-4 py-2 h-10 rounded hover:bg-pink-500 transition-colors disabled:opacity-50"
                        disabled={isLoading || !subwallets.length || !caAddress}
                    >
                        SELL ALL 💸
                    </button>
                </div>
            )}

            {/* Fund Modal */}
            <FundModal 
                isOpen={modalType === 'fund'}
                onClose={() => setModalType(null)}
                onConfirm={handleFundSubwallets}
                totalSubwallets={subwallets.length}
                subwallets={subwallets}
            >
                <ProgressIndicator progress={progress} />
            </FundModal>

            {/* Recover SOL Modal */}
            {modalType === 'recoverSol' && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold">🔄 Recover SOL</h2>
                            <button onClick={() => setModalType(null)} className="text-gray-400 hover:text-white">✕</button>
                        </div>

                        <div className="bg-gray-700/50 rounded p-4 mb-6">
                            <p>This will recover all SOL from your subwallets back to your main wallet.</p>
                            <p className="mt-2 text-sm text-gray-300">
                                Total SOL to recover: {subwallets.reduce((sum, w) => sum + (parseFloat(w.solBalance) || 0), 0)} SOL
                            </p>
                            <p className="mt-1 text-sm text-gray-300">
                                From {subwallets.length} subwallets
                            </p>
                        </div>

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setModalType(null)}
                                className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRecoverSol}
                                className="px-4 py-2 bg-orange-600 rounded hover:bg-orange-500"
                            >
                                Recover SOL 🔄
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {publicKey && subwallets.length === 0 && (
                <div className="text-center py-6 bg-gray-800/50 rounded-lg mt-4">
                    <p className="text-gray-300">No subwallets found. Generate new ones or restore from a file.</p>
                </div>
            )}

            {isLoading && loadingAction === 'refreshing' && (
                <div className="text-blue-400 mb-4 px-4 py-2 bg-blue-900/20 rounded">
                    Refreshing balances... This may take a moment.
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
                                                <div className="font-mono text-gray-400">
                                                    {formatPrivateKey(wallet.privateKey)}
                                                </div>
                                            </td>
                                            <td className="py-2 px-4">
                                                {wallet.isLoading ? (
                                                    <span className="animate-pulse">Loading...</span>
                                                ) : (
                                                    `${wallet.solBalance} SOL`
                                                )}
                                            </td>
                                            <td className="py-2 px-4">
                                                {wallet.isLoading ? (
                                                    <span className="animate-pulse">Loading...</span>
                                                ) : (
                                                    wallet.caBalance
                                                )}
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
    );
};

const ProgressIndicator = ({ progress }: { progress: FundingProgress }) => {
    return (
        <div className="mt-4 bg-gray-700/50 rounded p-4 space-y-3">
            <div className="flex justify-between text-sm">
                <span>
                    {progress.stage === 'preparing' && 'Preparing transactions...'}
                    {progress.stage === 'processing' && 'Processing transactions...'}
                    {progress.stage === 'confirming' && 'Confirming transactions...'}
                    {progress.stage === 'complete' && 'Funding complete!'}
                </span>
                <span>
                    {progress.processedWallets}/{progress.totalWallets} wallets
                </span>
            </div>

            <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                    className={`h-2 rounded-full transition-all duration-300 ${
                        progress.stage === 'complete' 
                            ? 'bg-green-500' 
                            : progress.error 
                                ? 'bg-red-500'
                                : 'bg-yellow-600'
                    }`}
                    style={{
                        width: `${(progress.processedWallets / progress.totalWallets) * 100}%`
                    }}
                />
            </div>

            {progress.error && (
                <div className="text-red-400 bg-red-900/20 rounded p-3 text-sm">
                    ⚠️ {progress.error}
                    <button
                        onClick={() => setProgress(prev => ({ ...prev, error: undefined }))}
                        className="ml-2 text-red-400 hover:text-red-300"
                    >
                        Try Again
                    </button>
                </div>
            )}

            {progress.stage === 'complete' && (
                <div className="text-green-400 bg-green-900/20 rounded p-3 text-sm">
                    ✅ Successfully funded {progress.totalWallets} wallets!
                </div>
            )}
        </div>
    );
};

export default SubwalletsPage; 