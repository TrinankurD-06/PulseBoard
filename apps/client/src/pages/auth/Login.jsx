import { zodResolver } from '@hookform/resolvers/zod';
import { DEMO_USER_EMAIL, DEMO_USER_PASSWORD } from '@pulseboard/shared/constants';
import { loginSchema } from '@pulseboard/shared/schemas';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '../../api/http.js';
import { useAppMeta } from '../../api/meta.js';
import { useAuth } from '../../auth/AuthContext.js';
import RingDotCta from '../../components/ui/RingDotCta.jsx';
import Field from '../../components/ui/Field.jsx';
import { oauthErrorMessage } from '../../lib/oauth.js';
import AuthLayout from './AuthLayout.jsx';
import OAuthButtons from './OAuthButtons.jsx';

// Created by "npm run seed"; only advertised when the server runs in DEMO_MODE.
const DEMO = { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD };

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
          <Link to="/register" className="text-fg underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {oauthError && (
        <p
          role="alert"
          className="mb-6 rounded-card border border-status-down/50 px-4 py-3 text-sm text-fg"
        >
          {oauthErrorMessage(oauthError)}
        </p>
      )}
      <OAuthButtons next={next} />
      <form onSubmit={onSubmit} noValidate className="space-y-6">
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
        <RingDotCta type="submit" className="mt-4" loading={isSubmitting}>
          Log in
        </RingDotCta>
        {meta?.demoMode && (
          <p className="rounded-card border border-line px-4 py-3 text-center text-xs text-muted">
            Demo account: {DEMO.email} / {DEMO.password}{' '}
            <button
              type="button"
              onClick={fillDemo}
              className="text-fg underline-offset-4 hover:underline"
            >
              Fill in
            </button>
          </p>
        )}
      </form>
    </AuthLayout>
  );
}
