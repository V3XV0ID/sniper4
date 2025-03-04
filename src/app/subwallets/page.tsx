'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { FC, useState, useEffect, useRef, ChangeEvent, KeyboardEvent, FormEvent, useCallback } from 'react';
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

interface TokenInfo {
    name: string;
    symbol: string;
    address: string;
}

interface JupiterToken {
    address: string;
    chainId: number;
    decimals: number;
    name: string;
    symbol: string;
    logoURI?: string;
    tags?: string[];
}

interface TokenListItem {
    address?: string;
    mint?: string; // Some lists use 'mint' instead of 'address'
    name: string;
    symbol: string;
    decimals: number;
    logoURI?: string;
}

interface TokenStats {
    price?: {
        usd: number;
        sol: number;
    };
    changes?: {
        m5: number;
        h1: number;
        h6: number;
        h24: number;
    };
    volume?: {
        usd: number;
        buys: number;
        sells: number;
        buyVolume: number;
        sellVolume: number;
    };
    transactions?: {
        total: number;
        buys: number;
        sells: number;
        buyers: number;
        sellers: number;
    };
}

// Cache object for token information
const tokenCache: { [key: string]: { data: TokenInfo; timestamp: number } } = {};
const CACHE_DURATION = 1000 * 60 * 15; // 15 minutes

const TOKEN_LIST_URLS = [
    'https://cache.jup.ag/tokens', // Jupiter
    'https://cdn.jsdelivr.net/gh/solana-labs/token-list@main/src/tokens/solana.tokenlist.json', // Solana
    'https://raw.githubusercontent.com/raydium-io/raydium-ui/master/src/tokens/mainnet.json', // Raydium
    'https://raw.githubusercontent.com/orca-so/orca-sdk/main/src/constants/tokens/mainnet.json', // Orca
];

async function getOnChainTokenInfo(
    mintAddress: string,
    connection: Connection
): Promise<TokenInfo | null> {
    try {
        const mintPubkey = new PublicKey(mintAddress);
        
        // Get mint info
        const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
        if (!mintInfo.value) return null;

        const data: any = mintInfo.value.data;
        const decimals = data.parsed.info.decimals;

        // Try to get metadata PDA
        const metadataPDA = PublicKey.findProgramAddressSync(
            [
                Buffer.from('metadata'),
                new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBuffer(),
                mintPubkey.toBuffer(),
            ],
            new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
        )[0];

        try {
            const metadata = await connection.getParsedAccountInfo(metadataPDA);
            if (metadata.value) {
                const metadataData: any = metadata.value.data;
                return {
                    name: metadataData.data.name || 'Unknown',
                    symbol: metadataData.data.symbol || '???',
                    address: mintPubkey.toString(),
                };
            }
        } catch (e) {
            console.log('No metadata found for token');
        }

        return {
            name: 'Unknown Token',
            symbol: '???',
            address: mintPubkey.toString(),
        };
    } catch (error) {
        console.error('Error fetching on-chain data:', error);
        return null;
    }
}

async function fetchTokenList(url: string): Promise<TokenListItem[]> {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch from ${url}`);
        
        const data = await response.json();
        
        // Handle different token list formats
        if (url.includes('jup.ag')) {
            return data.tokens || [];
        } else if (url.includes('solana-labs')) {
            return (data.tokens || []).map((token: any) => ({
                ...token,
                address: token.address || token.mint
            }));
        } else if (url.includes('raydium')) {
            return Object.entries(data).map(([address, token]: [string, any]) => ({
                ...token,
                address
            }));
        } else if (url.includes('orca')) {
            return Object.entries(data).map(([address, token]: [string, any]) => ({
                ...token,
                address
            }));
        }
        
        return [];
    } catch (error) {
        console.error(`Error fetching from ${url}:`, error);
        return [];
    }
}

// Token Info Display Component
function TokenInfoDisplay({ info }: { info: TokenInfo }) {
    return (
        <div className="bg-gray-800 rounded-lg p-3 flex items-center gap-3">
            {info.logoURI && (
                <img 
                    src={info.logoURI} 
                    alt={info.name} 
                    className="w-6 h-6 rounded-full"
                    onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                    }}
                />
            )}
            <div>
                <div className="font-semibold">{info.name}</div>
                <div className="text-sm text-gray-400">
                    {info.symbol}
                    {info.address && (
                        <span className="text-xs ml-2 text-gray-500">
                            ({info.address.slice(0, 4)}...{info.address.slice(-4)})
                        </span>
                    )}
                    <span className="text-xs ml-2 text-gray-500">
                        via {info.source}
                    </span>
                </div>
            </div>
        </div>
    );
}

// Function to extract pool/token address
const extractAddress = (input: string): string | null => {
    try {
        // Handle DEXScreener URL
        if (input.includes('dexscreener.com')) {
            const parts = input.split('/');
            return parts[parts.length - 1];
        }
        // Handle Solscan URL
        if (input.includes('solscan.io')) {
            const parts = input.split('/token/');
            return parts[parts.length - 1];
        }
        // Handle direct address input
        return input.trim();
    } catch (error) {
        console.error('Error extracting address:', error);
        return null;
    }
};

function DexScreenerChart({ pairAddress }: { pairAddress: string }) {
    return (
        <div className="w-full h-[600px] bg-gray-800 rounded-lg overflow-hidden mb-6">
            <iframe
                src={`https://dexscreener.com/solana/${pairAddress}?embed=1&theme=dark`}
                style={{
                    width: '100%',
                    height: '100%',
                    border: 'none',
                }}
                title="DEXScreener Chart"
            />
        </div>
    );
}

// Function to fetch token info from DEXScreener
const fetchTokenInfo = async (address: string): Promise<TokenInfo | null> => {
    console.log('Starting token fetch for address:', address);
    
    try {
        // Try as token address first
        const tokenResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
        const tokenData = await tokenResponse.json();
        console.log('Token response:', tokenData);

        if (tokenData.pairs && tokenData.pairs.length > 0) {
            // Find the pair with the highest liquidity
            const bestPair = tokenData.pairs.reduce((best: any, current: any) => {
                return (best.liquidity?.usd || 0) > (current.liquidity?.usd || 0) ? best : current;
            }, tokenData.pairs[0]);

            console.log('Best pair found:', bestPair);

            // Determine if the token is baseToken or quoteToken
            const isBase = bestPair.baseToken.address.toLowerCase() === address.toLowerCase();
            const token = isBase ? bestPair.baseToken : bestPair.quoteToken;

            return {
                name: token.name,
                symbol: token.symbol,
                address: token.address
            };
        }

        // If not found as token, try as pair
        const pairResponse = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${address}`);
        const pairData = await pairResponse.json();
        console.log('Pair response:', pairData);

        if (pairData.pairs && pairData.pairs[0]) {
            const pair = pairData.pairs[0];
            // Default to baseToken
            const token = pair.baseToken;

            return {
                name: token.name,
                symbol: token.symbol,
                address: token.address
            };
        }

        // If still not found, try one more time with modified address format
        // Sometimes DEXScreener needs the address without any wrapping
        const cleanAddress = address.replace(/[^a-zA-Z0-9]/g, '');
        const finalResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${cleanAddress}`);
        const finalData = await finalResponse.json();
        console.log('Final attempt response:', finalData);

        if (finalData.pairs && finalData.pairs[0]) {
            const token = finalData.pairs[0].baseToken;
            return {
                name: token.name,
                symbol: token.symbol,
                address: token.address
            };
        }

        console.log('No token data found after all attempts');
        return null;
    } catch (error) {
        console.error('Error fetching token:', error);
        return null;
    }
};

function TokenDashboard({ stats, tokenInfo }: { 
    stats: TokenStats; 
    tokenInfo: TokenInfo;
}) {
    // Safe number formatting helpers
    const formatNumber = (num: number | undefined | null) => {
        return num ? num.toLocaleString() : '0';
    };

    const formatCurrency = (num: number | undefined | null) => {
        if (!num) return '$0';
        return num >= 1000000 
            ? `$${(num/1000000).toFixed(1)}M`
            : `$${(num/1000).toFixed(0)}K`;
    };

    const formatPercent = (num: number | undefined | null) => {
        return (num || 0).toFixed(2);
    };

    // Ensure we have the required data
    const safeStats = {
        price: stats.price || { usd: 0, sol: 0 },
        changes: stats.changes || { m5: 0, h1: 0, h6: 0, h24: 0 },
        volume: stats.volume || { usd: 0, buys: 0, sells: 0, buyVolume: 0, sellVolume: 0 },
        transactions: stats.transactions || { total: 0, buys: 0, sells: 0, buyers: 0, sellers: 0 }
    };

    return (
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
            {/* Token Info Header */}
            <div className="mb-4 border-b border-gray-700 pb-2">
                <h2 className="text-xl font-bold">{tokenInfo.name} ({tokenInfo.symbol})</h2>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-4">
                {/* Price Section */}
                <div className="col-span-4 flex justify-between items-center border-b border-gray-700 pb-4">
                    <div>
                        <div className="text-sm text-gray-400">Price USD</div>
                        <div className="text-2xl font-bold">
                            ${(safeStats.price.usd || 0).toFixed(8)}
                        </div>
                    </div>
                    <div>
                        <div className="text-sm text-gray-400">Price SOL</div>
                        <div className="text-2xl font-bold">
                            {(safeStats.price.sol || 0).toFixed(8)} SOL
                        </div>
                    </div>
                </div>

                {/* Time Changes */}
                <div className="grid grid-cols-4 gap-2 col-span-4">
                    <TimeChange label="5M" value={safeStats.changes.m5 || 0} />
                    <TimeChange label="1H" value={safeStats.changes.h1 || 0} />
                    <TimeChange label="6H" value={safeStats.changes.h6 || 0} />
                    <TimeChange label="24H" value={safeStats.changes.h24 || 0} />
                </div>

                {/* Stats Grid */}
                <div className="col-span-4 grid grid-cols-3 gap-4 mt-4">
                    <StatBox 
                        label="Transactions" 
                        value={formatNumber(safeStats.transactions.total)}
                        subStats={[
                            { label: 'Buys', value: formatNumber(safeStats.transactions.buys) },
                            { label: 'Sells', value: formatNumber(safeStats.transactions.sells) }
                        ]}
                    />
                    <StatBox 
                        label="Volume" 
                        value={formatCurrency(safeStats.volume.usd)}
                        subStats={[
                            { label: 'Buy Vol', value: formatCurrency(safeStats.volume.buyVolume) },
                            { label: 'Sell Vol', value: formatCurrency(safeStats.volume.sellVolume) }
                        ]}
                    />
                    <StatBox 
                        label="Traders" 
                        value={formatNumber(
                            (safeStats.transactions.buyers || 0) + (safeStats.transactions.sellers || 0)
                        )}
                        subStats={[
                            { label: 'Buyers', value: formatNumber(safeStats.transactions.buys) },
                            { label: 'Sellers', value: formatNumber(safeStats.transactions.sells) }
                        ]}
                    />
                </div>
            </div>
        </div>
    );
}

// Helper components with null checks
function TimeChange({ label, value }: { label: string; value: number }) {
    const color = value >= 0 ? 'text-green-500' : 'text-red-500';
    return (
        <div className="bg-gray-700/50 rounded p-2">
            <div className="text-sm text-gray-400">{label}</div>
            <div className={`text-lg font-semibold ${color}`}>
                {value.toFixed(2)}%
            </div>
        </div>
    );
}

function StatBox({ label, value, subStats }: { 
    label: string; 
    value: string;
    subStats: { label: string; value: string; }[];
}) {
    return (
        <div className="bg-gray-700/50 rounded p-3">
            <div className="text-sm text-gray-400">{label}</div>
            <div className="text-xl font-bold mb-2">{value}</div>
            <div className="grid grid-cols-2 gap-2">
                {subStats.map(({ label, value }) => (
                    <div key={label}>
                        <div className="text-xs text-gray-400">{label}</div>
                        <div className="text-sm">{value}</div>
                    </div>
                ))}
            </div>
        </div>
    );
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
    const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
    const [isLoadingToken, setIsLoadingToken] = useState(false);
    const [showFundModal, setShowFundModal] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [displayedTokenName, setDisplayedTokenName] = useState('CA Balance');
    const [tokenStats, setTokenStats] = useState<TokenStats | null>(null);

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

    // Add this effect to fetch token name when CA changes
    useEffect(() => {
        let isSubscribed = true;

        const getTokenInfo = async () => {
            if (!inputValue) {
                setTokenInfo(null);
                setError(null);
                return;
            }

            setIsLoadingToken(true);
            setError(null);

            try {
                const address = extractAddress(inputValue);
                
                if (!address) {
                    setError('Invalid token address or URL');
                    return;
                }

                // Validate it's a valid Solana address
                try {
                    new PublicKey(address);
                } catch {
                    setError('Invalid Solana address format');
                    return;
                }

                const info = await fetchTokenInfo(address);
                
                if (isSubscribed) {
                    if (info) {
                        setTokenInfo(info);
                        setError(null);
                        setDisplayedTokenName(`${info.symbol || info.name} Balance`);
                    } else {
                        setTokenInfo(null);
                        setError('Token not found');
                    }
                }
            } catch (error) {
                if (isSubscribed) {
                    console.error('Error:', error);
                    setTokenInfo(null);
                    setError('Failed to fetch token information');
                }
            } finally {
                if (isSubscribed) {
                    setIsLoadingToken(false);
                }
            }
        };

        const timeoutId = setTimeout(getTokenInfo, 500);

        return () => {
            isSubscribed = false;
            clearTimeout(timeoutId);
        };
    }, [inputValue]);

    // Debug logging to track state updates
    useEffect(() => {
        console.log('Token Info Updated:', tokenInfo);
    }, [tokenInfo]);

    // Save token info to localStorage when it changes
    useEffect(() => {
        if (tokenInfo) {
            localStorage.setItem('currentToken', JSON.stringify(tokenInfo));
        } else {
            localStorage.removeItem('currentToken');
        }
    }, [tokenInfo]);

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
                solBalance: caAddress ? '...' : '0',
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

    const handleEnter = async () => {
        if (!inputValue.trim()) return;
        
        setIsLoading(true);
        try {
            const address = extractAddress(inputValue);
            if (!address) {
                console.error('Invalid address format');
                return;
            }

            console.log('Extracted address:', address);
            const info = await fetchTokenInfo(address);
            
            if (info) {
                console.log('Successfully found token info:', info);
                setTokenInfo(info);
                await fetchTokenStats(info.address);
            } else {
                console.log('No token info found');
                setTokenInfo(null);
            }
        } catch (error) {
            console.error('Error in handleEnter:', error);
            setTokenInfo(null);
        } finally {
            setIsLoading(false);
        }
    };

    const handleClear = () => {
        setInputValue('');
        setTokenInfo(null);
        localStorage.removeItem('currentToken');
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleEnter();
        }
    };

    // Add useEffect to debug UI updates
    useEffect(() => {
        console.log('Rendering with tokenInfo:', tokenInfo);
    }, [tokenInfo]);

    const fetchTokenStats = async (address: string) => {
        try {
            const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
            const data = await response.json();
            
            if (data.pairs && data.pairs[0]) {
                const pair = data.pairs[0];
                setTokenStats({
                    price: {
                        usd: parseFloat(pair.priceUsd),
                        sol: parseFloat(pair.priceNative),
                    },
                    changes: {
                        m5: pair.priceChange.m5,
                        h1: pair.priceChange.h1,
                        h6: pair.priceChange.h6,
                        h24: pair.priceChange.h24,
                    },
                    volume: {
                        usd: pair.volume.h24,
                        buys: pair.txns.h24.buys,
                        sells: pair.txns.h24.sells,
                        buyVolume: pair.volume.h24.buyVolume,
                        sellVolume: pair.volume.h24.sellVolume,
                    },
                    transactions: {
                        total: pair.txns.h24.total,
                        buys: pair.txns.h24.buys,
                        sells: pair.txns.h24.sells,
                        buyers: pair.txns.h24.buyers,
                        sellers: pair.txns.h24.sellers,
                    },
                });
            }
        } catch (error) {
            console.error('Error fetching token stats:', error);
        }
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
        <div className="container mx-auto p-4">
            {/* Top section with wallet info and buttons */}
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-4">
                    <div className="bg-purple-800 p-2 rounded">
                        <span>JP7...Zhai</span>
                    </div>
                    <div>Subwallets already generated</div>
                    <button
                        onClick={downloadSubwallets}
                        disabled={isLoading || !subwallets.length}
                        className="bg-blue-600 px-4 py-2 rounded flex items-center gap-2"
                    >
                        Download Subwallets 📥
                    </button>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isLoading}
                        className="bg-purple-600 px-4 py-2 rounded"
                    >
                        Restore Subwallets
                    </button>
                    <button
                        onClick={() => void refreshBalances()}
                        disabled={isLoading || !subwallets.length}
                        className="bg-green-600 px-4 py-2 rounded flex items-center gap-2"
                    >
                        Refresh Balances 🔄
                    </button>
                </div>
            </div>

            {/* Parent Wallet and Sniper Target section */}
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-2">
                    <span className="text-gray-400">Parent Wallet</span>
                    <span>📋 J1P7JYF1pEWu1GceZjwNR78wNJ7FU2iD3UjTzwrNZhai</span>
                </div>

                {/* Sniper Target */}
                <div className="flex flex-col gap-2">
                    <div className="text-white">Sniper Target</div>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder="Enter CA or URL"
                            className="bg-gray-700 rounded p-2 text-white w-64"
                        />
                        <button
                            onClick={handleEnter}
                            disabled={isLoadingToken || !inputValue.trim()}
                            className={`px-4 py-2 rounded ${
                                isLoadingToken || !inputValue.trim()
                                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                    : 'bg-gray-700 hover:bg-gray-600 text-white'
                            }`}
                        >
                            {isLoadingToken ? (
                                <span className="flex items-center gap-2">
                                    <span className="animate-spin">⏳</span>
                                </span>
                            ) : (
                                'Enter'
                            )}
                        </button>
                        <button
                            onClick={handleClear}
                            className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded text-white"
                        >
                            Clear
                        </button>
                    </div>
                </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-4 mb-6">
                <button
                    onClick={() => setModalType('fund')}
                    className="bg-orange-600 px-4 py-2 rounded flex items-center gap-2"
                    disabled={isLoading || !subwallets.length}
                >
                    Fund Subwallets with SOL
                </button>
                <button
                    onClick={() => setModalType('recoverSol')}
                    className="bg-red-600 px-4 py-2 rounded flex items-center gap-2"
                    disabled={isLoading || !subwallets.length}
                >
                    Recover SOL from Subwallets 🔄
                </button>
                <button
                    onClick={() => setModalType('recoverCA')}
                    className="bg-purple-800 px-4 py-2 rounded flex items-center gap-2"
                    disabled={isLoading || !subwallets.length || !caAddress}
                >
                    Recover CA tokens from Subwallets
                </button>
                <button
                    onClick={() => setModalType('sellAll')}
                    className="bg-pink-600 px-4 py-2 rounded flex items-center gap-2"
                    disabled={isLoading || !subwallets.length || !caAddress}
                >
                    SELL ALL 💸
                </button>
            </div>

            {/* Only render dashboard if we have stats */}
            {tokenStats && tokenInfo && (
                <TokenDashboard 
                    stats={tokenStats} 
                    tokenInfo={tokenInfo}
                />
            )}

            {/* Loading indicator for stats */}
            {isLoading && (
                <div className="bg-gray-800 rounded-lg p-4 mb-6">
                    <div className="animate-pulse flex space-x-4">
                        <div className="flex-1 space-y-4 py-1">
                            <div className="h-4 bg-gray-700 rounded w-3/4"></div>
                            <div className="space-y-2">
                                <div className="h-4 bg-gray-700 rounded"></div>
                                <div className="h-4 bg-gray-700 rounded w-5/6"></div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Generated Subwallets table */}
            <div className="overflow-x-auto">
                <table className="min-w-full bg-gray-800/50 rounded-lg overflow-hidden">
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
                                        <span className="font-medium text-blue-400">
                                            {tokenInfo ? tokenInfo.symbol : 'CA Balance'}
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Debug info - remove in production */}
            <div className="mt-4 text-xs text-gray-500">
                {tokenInfo && (
                    <pre>
                        Current Token: {JSON.stringify(tokenInfo, null, 2)}
                    </pre>
                )}
            </div>
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