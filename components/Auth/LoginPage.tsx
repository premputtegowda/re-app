'use client';

import { motion } from 'framer-motion';
import { Clock, Shield, CheckCircle2, Home, BarChart2, Calculator } from 'lucide-react';
import GoogleLoginButton from './GoogleLoginButton';
import { useAuthStore } from '@/lib/authStore';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const { error, setError } = useAuthStore();
  const requestSubmitted = error === 'ACCESS_REQUEST_SUBMITTED';
  const requestPending = error === 'ACCESS_REQUEST_PENDING';

  const features = [
    {
      icon: Clock,
      title: 'REPS Tracker',
      description: 'Track and document your Real Estate Professional Status hours with AI-powered classification and audit-ready reports.',
      available: true,
    },
    {
      icon: Calculator,
      title: 'Deal Analyzer',
      description: 'Analyze deals with data-driven price guidance — model cash flows, returns, and refinance scenarios, assess uncertainty, and know the right price before you buy.',
      available: true,
    },
    {
      icon: BarChart2,
      title: 'Market Research',
      description: 'Track unemployment, population growth, rent trends, vacancy rates, and supply vs. demand to identify the strongest markets.',
      available: false,
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-lg"
      >
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4"
          >
            <Home className="w-8 h-8 text-white" />
          </motion.div>
          <div className="flex items-center justify-center gap-2">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              DealstackRE
            </h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700">
              Beta
            </span>
          </div>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Your all-in-one platform for smarter real estate investing
          </p>
        </div>

        {/* Login Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8"
        >
          {requestSubmitted ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-4 py-2"
            >
              <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto">
                <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" size={24} />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Request received!</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  This app is invite only. We'll review your request and reach out when you're approved.
                </p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
              >
                Back to sign in
              </button>
            </motion.div>
          ) : requestPending ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-4 py-2"
            >
              <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto">
                <Shield className="text-amber-600 dark:text-amber-400" size={24} />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Request under review</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Your request is being reviewed. We'll reach out once you've been granted access.
                </p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
              >
                Back to sign in
              </button>
            </motion.div>
          ) : (
            <>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
                >
                  <p className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>
                </motion.div>
              )}

              <div className="flex justify-center">
                <GoogleLoginButton
                  onSuccess={onLoginSuccess}
                  onError={(err) => setError(err)}
                />
              </div>

              <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-6">
                By signing in, you agree to our{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700 dark:hover:text-gray-300">Terms of Service</a>
                {' '}and{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700 dark:hover:text-gray-300">Privacy Policy</a>
              </p>
            </>
          )}
        </motion.div>

        {/* Features */}
        <div className="mt-8 grid gap-4">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + index * 0.1 }}
              className={`flex items-center gap-4 rounded-xl p-4 ${
                feature.available
                  ? 'bg-white/70 dark:bg-gray-800/70'
                  : 'bg-white/40 dark:bg-gray-800/40'
              } backdrop-blur`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                feature.available
                  ? 'bg-blue-100 dark:bg-blue-900/30'
                  : 'bg-gray-100 dark:bg-gray-700/50'
              }`}>
                <feature.icon className={`w-5 h-5 ${
                  feature.available
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-400 dark:text-gray-500'
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className={`font-medium ${
                    feature.available
                      ? 'text-gray-900 dark:text-white'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}>
                    {feature.title}
                  </h3>
                  {!feature.available && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 font-medium">
                      Coming soon
                    </span>
                  )}
                </div>
                <p className={`text-sm mt-0.5 ${
                  feature.available
                    ? 'text-gray-600 dark:text-gray-400'
                    : 'text-gray-400 dark:text-gray-500'
                }`}>
                  {feature.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
