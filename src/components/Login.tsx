import { useState, useRef, useEffect, FormEvent, KeyboardEvent, ClipboardEvent } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usernameToEmail } from '../lib/username';

const PIN_LENGTH = 6;

export default function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [username, setUsername] = useState('');
  const [digits, setDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [pinVisible, setPinVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const boxRefs = useRef<(HTMLInputElement | null)[]>([]);

  const setDigit = (i: number, value: string) => {
    const clean = value.replace(/\D/g, '').slice(-1);
    setDigits(prev => {
      const next = [...prev];
      next[i] = clean;
      return next;
    });
    if (clean && i < PIN_LENGTH - 1) boxRefs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      boxRefs.current[i - 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, PIN_LENGTH);
    if (!text) return;
    e.preventDefault();
    setDigits(Array.from({ length: PIN_LENGTH }, (_, i) => text[i] ?? ''));
    boxRefs.current[Math.min(text.length, PIN_LENGTH - 1)]?.focus();
  };

  const toggleMode = () => {
    setMode(m => (m === 'signin' ? 'signup' : 'signin'));
    setError(null);
  };

  // The hero is dark and the rest of the page is white, so an iOS elastic overscroll at the very
  // top of the page should reveal more dark, not the app's usual light background.
  useEffect(() => {
    const prevBody = document.body.style.background;
    const prevHtml = document.documentElement.style.background;
    document.body.style.background = '#0f172a';
    document.documentElement.style.background = '#0f172a';
    return () => {
      document.body.style.background = prevBody;
      document.documentElement.style.background = prevHtml;
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const pin = digits.join('');
    if (!username.trim()) {
      setError('Enter a username');
      return;
    }
    if (pin.length < PIN_LENGTH) {
      setError('Enter all 6 digits of your PIN');
      return;
    }
    setSubmitting(true);
    const email = usernameToEmail(username);
    const message = mode === 'signin' ? await signIn(email, pin) : await signUp(email, pin);
    setSubmitting(false);
    if (message) setError(message);
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="relative overflow-hidden bg-slate-900 px-6 pb-16 pt-14 animate-hero-drop">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">TRAKMTRX</h1>
        <p className="mt-2 text-sm text-slate-300">
          {mode === 'signin' ? 'Welcome back — sign in to continue.' : 'Create an account to get started.'}
        </p>
        <svg
          viewBox="0 0 400 56"
          preserveAspectRatio="none"
          className="absolute inset-x-0 -bottom-px h-12 w-full text-white"
        >
          <path d="M0,56 C110,0 290,56 400,8 L400,56 Z" fill="currentColor" className="animate-wave-rise" />
        </svg>
      </div>

      <div className="mx-auto w-full max-w-sm px-6 pb-10 pt-2">
        <h2 className="text-2xl font-bold text-slate-900 animate-rise-in" style={{ animationDelay: '160ms' }}>
          {mode === 'signin' ? 'Login' : 'Sign up'}
        </h2>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="animate-rise-in" style={{ animationDelay: '220ms' }}>
            <label htmlFor="username" className="mb-1.5 block text-xs font-medium text-slate-500">
              Username
            </label>
            <input
              id="username"
              type="text"
              required
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:bg-white sm:text-sm"
            />
          </div>

          <div className="animate-rise-in" style={{ animationDelay: '280ms' }}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">PIN</span>
              <button
                type="button"
                onClick={() => setPinVisible(v => !v)}
                aria-label={pinVisible ? 'Hide PIN' : 'Show PIN'}
                className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                {pinVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {pinVisible ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="flex justify-between gap-2">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { boxRefs.current[i] = el; }}
                  type={pinVisible ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={handlePaste}
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 text-center text-lg text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                />
              ))}
            </div>
          </div>

          {error && <p className="text-center text-xs text-red-600">{error}</p>}

          <div className="animate-rise-in" style={{ animationDelay: '340ms' }}>
            <button
              type="submit"
              disabled={submitting}
              style={{ width: submitting ? '3.5rem' : '100%' }}
              className="mx-auto flex items-center justify-center gap-2 rounded-full bg-slate-900 py-3.5 text-sm font-semibold text-white transition-[width,transform] duration-500 ease-[cubic-bezier(0.65,0,0.35,1)] hover:bg-slate-800 active:scale-[0.97] disabled:opacity-100"
            >
              {submitting ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : mode === 'signin' ? 'Login' : 'Create account'}
            </button>
          </div>
        </form>

        <p className="mt-8 text-center text-sm text-slate-500 animate-rise-in" style={{ animationDelay: '400ms' }}>
          {mode === 'signin' ? (
            <>Don't have an account? <button onClick={toggleMode} className="font-semibold text-slate-900">Sign up</button></>
          ) : (
            <>Already have an account? <button onClick={toggleMode} className="font-semibold text-slate-900">Login</button></>
          )}
        </p>
      </div>
    </div>
  );
}
