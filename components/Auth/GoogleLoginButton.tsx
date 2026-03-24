'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '@/lib/authStore';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: {
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
              width?: number;
            }
          ) => void;
          prompt: () => void;
        };
      };
    };
  }
}

interface GoogleLoginButtonProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export default function GoogleLoginButton({
  onSuccess,
  onError,
}: GoogleLoginButtonProps) {
  const { login, isLoading } = useAuthStore();

  const callbackRef = useRef<(response: { credential: string }) => void>();
  callbackRef.current = useCallback(
    async (response: { credential: string }) => {
      try {
        await login(response.credential);
        onSuccess?.();
      } catch (error) {
        onError?.(error instanceof Error ? error.message : 'Login failed');
      }
    },
    [login, onSuccess, onError]
  );

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      console.error('Google Client ID not configured');
      return;
    }

    const initGoogle = () => {
      if (!window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => callbackRef.current?.(response),
      });
      const buttonDiv = document.getElementById('google-signin-button');
      if (buttonDiv) {
        window.google.accounts.id.renderButton(buttonDiv, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          width: 280,
        });
      }
    };

    // If script already loaded, initialize directly
    if (window.google) {
      initGoogle();
      return;
    }

    // Avoid injecting duplicate script tags
    if (document.querySelector('script[src="https://accounts.google.com/gsi/client"]')) {
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initGoogle;
    document.body.appendChild(script);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-10 w-[280px] bg-gray-100 dark:bg-gray-800 rounded animate-pulse">
        <span className="text-gray-500 dark:text-gray-400">Loading...</span>
      </div>
    );
  }

  return <div id="google-signin-button" className="flex justify-center" />;
}
