import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '@pulseboard/shared/schemas';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '../../api/http.js';
import { useAppMeta } from '../../api/meta.js';
import { useAuth } from '../../auth/AuthContext.js';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import { oauthErrorMessage } from '../../lib/oauth.js';
import AuthLayout from './AuthLayout.jsx';
import OAuthButtons from './OAuthButtons.jsx';

// Created by "npm run seed"; only advertised when the server runs in DEMO_MODE.
const DEMO = { email: 'demo@pulseboard.dev', password: 'demo1234' };

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: meta } = useAppMeta();
  // Return to the page that sent the user here, if any.
  const next = location.state?.from?.pathname ?? '/app';
  // Set by /auth/callback when Google/GitHub sign-in failed.
  const oauthError = location.state?.oauthError;
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const fillDemo = () => {
    setValue('email', DEMO.email);
    setValue('password', DEMO.password);
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values);
      navigate(next, { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to your PulseBoard account"
      footer={
        <>
          New here?{' '}
          <Link
            to="/register"
            className="font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            Create an account
          </Link>
        </>
      }
    >
      {oauthError && (
        <p
          role="alert"
          className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
        >
          {oauthErrorMessage(oauthError)}
        </p>
      )}
      <OAuthButtons next={next} />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          error={errors.email?.message}
          {...register('email')}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Log in
        </Button>
        {meta?.demoMode && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
            Demo account: {DEMO.email} / {DEMO.password}{' '}
            <button
              type="button"
              onClick={fillDemo}
              className="font-medium text-brand-700 hover:underline dark:text-brand-400"
            >
              Fill in
            </button>
          </p>
        )}
      </form>
    </AuthLayout>
  );
}
