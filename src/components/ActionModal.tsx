import { useState } from 'react';

export type ActionType = 'fund' | 'recoverSol' | 'recoverCA' | 'sellAll';

interface FundParameters {
  totalBudget: number;
  walletsToFund: number;
  isRandom: boolean;
  minAmount?: number;
  maxAmount?: number;
  distributionPlan: DistributionPreview[];
  totalFees: number;
}

interface ActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (params?: FundParameters) => Promise<void>;
  action: ActionType;
  totalSubwallets: number;
}

interface DistributionPreview {
  walletIndex: number;
  publicKey: string;
  amount: number;
}

export const ActionModal: React.FC<ActionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  action,
  totalSubwallets
}) => {
  const [amount, setAmount] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fundParams, setFundParams] = useState<FundParameters>({
    totalBudget: 0,
    walletsToFund: 0,
    isRandom: false,
    minAmount: 0,
    maxAmount: 0,
    distributionPlan: [],
    totalFees: 0
  });

  const getModalContent = (action: ActionType) => {
    switch (action) {
      case 'fund':
        return {
          title: 'Fund Subwallets with SOL',
          description: 'Configure how you want to distribute SOL to your subwallets:',
          confirmText: 'Fund Subwallets',
          icon: '💰',
          color: 'bg-yellow-600 hover:bg-yellow-500'
        };
      case 'recoverSol':
        return {
          title: 'Recover SOL from Subwallets',
          description: 'This will recover all SOL from your subwallets back to your main wallet.',
          confirmText: 'Recover SOL',
          icon: '🔄',
          color: 'bg-orange-600 hover:bg-orange-500'
        };
      case 'recoverCA':
        return {
          title: 'Recover CA Tokens from Subwallets',
          description: 'This will recover all CA tokens from your subwallets back to your main wallet.',
          confirmText: 'Recover Tokens',
          icon: '🔄',
          color: 'bg-red-600 hover:bg-red-500'
        };
      case 'sellAll':
        return {
          title: 'Sell All Tokens',
          description: 'This will sell all CA tokens from your subwallets.',
          confirmText: 'Confirm Sell All',
          icon: '💸',
          color: 'bg-pink-600 hover:bg-pink-500'
        };
    }
  };

  const content = getModalContent(action);

  const handleConfirm = async () => {
    try {
      setError(null);
      setIsProcessing(true);

      if (action === 'fund') {
        if (fundParams.totalBudget <= 0) {
          throw new Error('Total budget must be greater than 0');
        }
        if (fundParams.walletsToFund <= 0) {
          throw new Error('Number of wallets must be greater than 0');
        }
        if (fundParams.isRandom) {
          if (fundParams.minAmount! > fundParams.maxAmount!) {
            throw new Error('Minimum amount cannot be greater than maximum amount');
          }
          if (fundParams.minAmount! * fundParams.walletsToFund > fundParams.totalBudget) {
            throw new Error('Total budget too low for minimum amounts');
          }
        }
        await onConfirm(fundParams);
      } else {
        await onConfirm();
      }
      
      onClose();
      setFundParams({
        totalBudget: 0,
        walletsToFund: 0,
        isRandom: false,
        minAmount: 0,
        maxAmount: 0,
        distributionPlan: [],
        totalFees: 0
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  const calculateDistribution = (params: Omit<FundParameters, 'distributionPlan' | 'totalFees'>): {
    distribution: DistributionPreview[];
    fees: number;
  } => {
    const TX_FEE = 0.000005; // SOL per transaction
    const amounts: number[] = [];
    
    if (params.isRandom) {
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
      for (let i = 0; i < params.walletsToFund; i++) {
        amounts.push(Number(amount.toFixed(4)));
      }
    }

    // Calculate total fees (one transaction per wallet)
    const totalFees = TX_FEE * params.walletsToFund;

    return {
      distribution: amounts.map((amount, index) => ({
        walletIndex: index,
        publicKey: subwallets[index].publicKey,
        amount
      })),
      fees: totalFees
    };
  };

  const DistributionPreview = () => {
    const { distribution, fees } = calculateDistribution(fundParams);
    const totalWithFees = fundParams.totalBudget + fees;

    return (
      <div className="mt-4 border-t border-gray-700 pt-4">
        <h3 className="text-sm font-medium text-gray-300 mb-2">Distribution Preview</h3>
        
        <div className="bg-gray-800 rounded-lg p-4 space-y-4">
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400">
                  <th className="text-left py-2">Wallet</th>
                  <th className="text-right">Amount (SOL)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {distribution.map((item) => (
                  <tr key={item.walletIndex}>
                    <td className="py-2">
                      <span className="text-gray-400">#{item.walletIndex}</span>
                      <span className="text-gray-500 ml-2">
                        {truncateKey(item.publicKey)}
                      </span>
                    </td>
                    <td className="text-right text-yellow-400">
                      {item.amount.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-gray-700 pt-4 space-y-2">
            <div className="flex justify-between text-gray-400">
              <span>Total to Distribute:</span>
              <span>{fundParams.totalBudget.toFixed(4)} SOL</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Transaction Fees ({distribution.length} tx):</span>
              <span>{fees.toFixed(6)} SOL</span>
            </div>
            <div className="flex justify-between text-white font-medium">
              <span>Total Cost:</span>
              <span>{totalWithFees.toFixed(6)} SOL</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const FundForm = ({ totalSubwallets }: { totalSubwallets: number }) => {
    const [walletCountInput, setWalletCountInput] = useState('');

    return (
      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Total Budget (SOL)
          </label>
          <input
            type="number"
            value={fundParams.totalBudget || ''}
            onChange={(e) => setFundParams(prev => ({
              ...prev,
              totalBudget: parseFloat(e.target.value) || 0
            }))}
            placeholder="Enter total SOL"
            className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600 
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Number of Wallets to Fund (max {totalSubwallets})
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              value={walletCountInput}
              onChange={(e) => {
                const value = e.target.value;
                setWalletCountInput(value);
                const numValue = parseInt(value) || 0;
                setFundParams(prev => ({
                  ...prev,
                  walletsToFund: Math.min(Math.max(0, numValue), totalSubwallets)
                }));
              }}
              placeholder={`1-${totalSubwallets} wallets`}
              className="flex-1 bg-gray-700 text-white p-2 rounded border border-gray-600 
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="1"
              max={totalSubwallets}
            />
            <button
              onClick={() => {
                const maxValue = totalSubwallets.toString();
                setWalletCountInput(maxValue);
                setFundParams(prev => ({
                  ...prev,
                  walletsToFund: totalSubwallets
                }));
              }}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded border border-gray-600
                text-sm text-white transition-colors"
            >
              Max
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 py-2">
          <input
            type="checkbox"
            id="randomize"
            checked={fundParams.isRandom}
            onChange={(e) => setFundParams(prev => ({
              ...prev,
              isRandom: e.target.checked
            }))}
            className="rounded border-gray-600 bg-gray-700 text-blue-500 
              focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
          />
          <label htmlFor="randomize" className="text-sm text-gray-300">
            Randomize amounts
          </label>
        </div>

        {fundParams.isRandom && (
          <div className="space-y-4 pl-4 border-l-2 border-gray-700">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Minimum Amount (SOL)
              </label>
              <input
                type="number"
                value={fundParams.minAmount || ''}
                onChange={(e) => setFundParams(prev => ({
                  ...prev,
                  minAmount: parseFloat(e.target.value) || 0
                }))}
                placeholder="Min SOL per wallet"
                className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600 
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                  placeholder-gray-400"
                step="0.01"
                min="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Maximum Amount (SOL)
              </label>
              <input
                type="number"
                value={fundParams.maxAmount || ''}
                onChange={(e) => setFundParams(prev => ({
                  ...prev,
                  maxAmount: parseFloat(e.target.value) || 0
                }))}
                placeholder="Max SOL per wallet"
                className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600 
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                  placeholder-gray-400"
                step="0.01"
                min={fundParams.minAmount}
              />
            </div>
          </div>
        )}

        {fundParams.totalBudget > 0 && fundParams.walletsToFund > 0 && (
          <DistributionPreview />
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div 
        className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            {content.icon} {content.title}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            disabled={isProcessing}
          >
            ✕
          </button>
        </div>

        <p className="text-gray-300 mb-4">{content.description}</p>

        {action === 'fund' && (
          <FundForm totalSubwallets={totalSubwallets} />
        )}

        {error && (
          <div className="text-red-500 bg-red-500/10 p-3 rounded mb-4">
            ⚠️ {error}
          </div>
        )}

        <div className="flex justify-end gap-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 rounded transition-colors disabled:opacity-50 flex items-center gap-2 ${content.color}`}
            disabled={isProcessing || (action === 'fund' && !amount)}
          >
            {isProcessing ? (
              <>
                <span className="animate-spin">⏳</span>
                Processing...
              </>
            ) : (
              <>
                {content.confirmText} {content.icon}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}; 