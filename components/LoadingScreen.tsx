import React from 'react';

const LoadingScreen: React.FC<{ message?: string }> = ({ message = "Sınav hazırlanıyor..." }) => {
  return (
    <div className="fixed inset-0 bg-white dark:bg-gray-900 z-50 flex flex-col items-center justify-center p-4 transition-colors duration-200">
      <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4 dark:border-gray-700 dark:border-t-blue-500"></div>
      <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200">{message}</h2>
      <p className="text-gray-500 dark:text-gray-400 text-sm mt-2 text-center max-w-md">
        Yapay zeka dosyanızdaki soruları ve şıkları tarıyor. Bu işlem dosya boyutuna göre biraz zaman alabilir.
      </p>
    </div>
  );
};

export default LoadingScreen;