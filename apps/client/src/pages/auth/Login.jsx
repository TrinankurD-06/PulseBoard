import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '@pulseboard/shared/schemas';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.js';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import AuthLayout from './AuthLayout.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values);
      // Return to the page that sent the user here, if any.
      navigate(location.state?.from?.pathname ?? '/app', { replace: true });
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
            className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
          >
            Create an account
          </Link>
        </>
      }
    >
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
      </form>
    </AuthLayout>
  );
}
