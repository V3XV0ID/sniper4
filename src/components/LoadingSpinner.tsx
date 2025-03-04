export const LoadingSpinner = () => {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="relative w-12 h-12">
        <div className="absolute w-full h-full border-4 border-gray-700 rounded-full"></div>
        <div className="absolute w-full h-full border-4 border-t-purple-500 rounded-full animate-spin"></div>
      </div>
    </div>
  );
}; 