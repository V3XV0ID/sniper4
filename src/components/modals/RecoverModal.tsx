'use client';

import { useState } from 'react';

interface RecoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  type: 'sol' | 'ca';
  totalSubwallets: number;
  estimatedBalance?: number;
}

export const RecoverModal: React.FC<RecoverModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  type,
  totalSubwallets,
  estimatedBalance
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const modalConfig = {
    sol: {
      title: '🔄 Recover SOL from Subwallets',
      description: 'This will recover all SOL from your subwallets back to your main wallet.',
      buttonColor: 'bg-orange-600 hover:bg-orange-500',
      buttonText: 'Recover SOL 🔄',
      unit: 'SOL'
    },
    ca: {
      title: '🔄 Recover CA Tokens from Subwallets',
      description: 'This will recover all CA tokens from your subwallets back to your main wallet.',
      buttonColor: 'bg-red-600 hover:bg-red-500',
      buttonText: 'Recover Tokens 🔄',
      unit: 'tokens'
    }
  }[type];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">{modalConfig.title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="space-y-4">
          <div className="bg-gray-700/50 rounded p-4">
            <p className="mb-2">{modalConfig.description}</p>
            <div className="text-sm text-gray-300">
              <p>Number of subwallets: {totalSubwallets}</p>
              {estimatedBalance !== undefined && (
                <p className="mt-1">
                  Estimated total: {estimatedBalance} {modalConfig.unit}
                </p>
              )}
            </div>
          </div>

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
                await onConfirm();
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Recovery failed');
              } finally {
                setIsProcessing(false);
              }
            }}
            disabled={isProcessing}
            className={`px-4 py-2 rounded disabled:opacity-50 ${modalConfig.buttonColor}`}
          >
            {isProcessing ? 'Processing...' : modalConfig.buttonText}
          </button>
        </div>
      </div>
    </div>
  );
}; 