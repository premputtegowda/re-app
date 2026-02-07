'use client';

import { motion } from 'framer-motion';
import { Clock, TrendingUp, Shield } from 'lucide-react';
import GoogleLoginButton from './GoogleLoginButton';
import { useAuthStore } from '@/lib/authStore';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const { error, setError } = useAuthStore();

  const features = [
    {
      icon: Clock,
      title: 'Track Your Hours',
      description: 'Log material and non-material participation hours easily',
    },
    {
      icon: TrendingUp,
      title: 'Analytics Dashboard',
      description: 'Visualize your progress with detailed charts and summaries',
    },
    {
      icon: Shield,
      title: 'REPS Compliance',
      description: 'Stay on track with your Real Estate Professional Status',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4"
          >
            <Clock className="w-8 h-8 text-white" />
          </motion.div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            REPS Tracker
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Track your Real Estate Professional Status hours
          </p>
        </div>

        {/* Login Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8"
        >
          <h2 className="text-xl font-semibold text-center text-gray-900 dark:text-white mb-6">
            Sign in to continue
          </h2>

          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
            >
              <p className="text-sm text-red-600 dark:text-red-400 text-center">
                {error}
              </p>
            </motion.div>
          )}

          <div className="flex justify-center">
            <GoogleLoginButton
              onSuccess={onLoginSuccess}
              onError={(err) => setError(err)}
            />
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-6">
            By signing in, you agree to our Terms of Service and Privacy Policy
          </p>
        </motion.div>

        {/* Features */}
        <div className="mt-8 grid gap-4">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + index * 0.1 }}
              className="flex items-center gap-4 bg-white/50 dark:bg-gray-800/50 backdrop-blur rounded-xl p-4"
            >
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                <feature.icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  {feature.title}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
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
