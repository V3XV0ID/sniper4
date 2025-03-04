'use client';

import { useState } from 'react';

interface FundParameters {
  totalBudget: number;
  walletsToFund: number;
  isRandom: boolean;
  minAmount?: number;
  maxAmount?: number;
}

interface FundModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (params: FundParameters) => Promise<void>;
  totalSubwallets: number;
  subwallets: Array<{ publicKey: string }>;
}

export const FundModal: React.FC<FundModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  totalSubwallets,
  subwallets
}) => {
  const [params, setParams] = useState<FundParameters>({
    totalBudget: 0,
    walletsToFund: 0,
    isRandom: false,
    minAmount: 0,
    maxAmount: 0
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">💰 Fund Subwallets with SOL</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="space-y-4">
          {/* Total Budget Input */}
          <div>
            <label className="block text-sm mb-1">Total Budget (SOL)</label>
            <input
              type="number"
              value={params.totalBudget || ''}
              onChange={e => setParams(prev => ({
                ...prev,
                totalBudget: parseFloat(e.target.value) || 0
              }))}
              className="w-full bg-gray-700 rounded p-2 text-white"
              placeholder="Enter amount in SOL"
              step="0.01"
              min="0"
            />
          </div>

          {/* Number of Wallets Input */}
          <div>
            <label className="block text-sm mb-1">
              Number of Wallets ({totalSubwallets} available)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={params.walletsToFund || ''}
                onChange={e => setParams(prev => ({
                  ...prev,
                  walletsToFund: Math.min(
                    Math.max(1, parseInt(e.target.value) || 0),
                    totalSubwallets
                  )
                }))}
                className="flex-1 bg-gray-700 rounded p-2 text-white"
                placeholder={`1-${totalSubwallets}`}
                min="1"
                max={totalSubwallets}
              />
              <button
                onClick={() => setParams(prev => ({
                  ...prev,
                  walletsToFund: totalSubwallets
                }))}
                className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
              >
                Max
              </button>
            </div>
          </div>

          {/* Random Distribution Toggle */}
          <label className="flex items-center gap-2 py-2">
            <input
              type="checkbox"
              checked={params.isRandom}
              onChange={e => setParams(prev => ({
                ...prev,
                isRandom: e.target.checked
              }))}
              className="rounded border-gray-600"
            />
            <span>Randomize amounts</span>
          </label>

          {error && (
            <div className="text-red-400 bg-red-900/20 rounded p-3 text-sm">
              ⚠️ {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              try {
                setIsProcessing(true);
                await onConfirm(params);
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to fund wallets');
              } finally {
                setIsProcessing(false);
              }
            }}
            disabled={isProcessing || !params.totalBudget || !params.walletsToFund}
            className="px-4 py-2 bg-yellow-600 rounded hover:bg-yellow-500 disabled:opacity-50"
          >
            {isProcessing ? 'Processing...' : 'Fund Subwallets 💰'}
          </button>
        </div>
      </div>
    </div>
  );
}; 