import { useState } from 'react';

type ActionType = 'fund' | 'recoverSol' | 'recoverCA' | 'sellAll';

interface ActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (amount?: number) => Promise<void>;
  action: ActionType;
}

export const ActionModal: React.FC<ActionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  action
}) => {
  const [amount, setAmount] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getModalContent = (action: ActionType) => {
    switch (action) {
      case 'fund':
        return {
          title: 'Fund Subwallets with SOL 💰',
          description: 'Enter the amount of SOL to distribute to each subwallet:',
          confirmText: 'Fund Subwallets',
          icon: '💰'
        };
      case 'recoverSol':
        return {
          title: 'Recover SOL from Subwallets 🔄',
          description: 'This will recover all SOL from your subwallets back to your main wallet.',
          confirmText: 'Recover SOL',
          icon: '🔄'
        };
      case 'recoverCA':
        return {
          title: 'Recover CA Tokens from Subwallets 🔄',
          description: 'This will recover all CA tokens from your subwallets back to your main wallet.',
          confirmText: 'Recover Tokens',
          icon: '🔄'
        };
      case 'sellAll':
        return {
          title: 'Sell All Tokens 💸',
          description: 'This will sell all CA tokens from your subwallets.',
          confirmText: 'Confirm Sell All',
          icon: '💸'
        };
    }
  };

  const content = getModalContent(action);

  const handleConfirm = async () => {
    try {
      setError(null);
      setIsProcessing(true);
      if (action === 'fund') {
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
          throw new Error('Please enter a valid amount');
        }
        await onConfirm(parsedAmount);
      } else {
        await onConfirm();
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{content.title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            disabled={isProcessing}
          >
            ✕
          </button>
        </div>

        <p className="text-gray-300 mb-4">{content.description}</p>

        {action === 'fund' && (
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Enter SOL amount"
            className="w-full bg-gray-700 rounded p-2 mb-4"
            disabled={isProcessing}
          />
        )}

        {error && (
          <div className="text-red-500 mb-4">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600"
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 flex items-center gap-2"
            disabled={isProcessing}
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