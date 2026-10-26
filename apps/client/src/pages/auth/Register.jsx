import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema } from '@pulseboard/shared/schemas';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.js';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import AuthLayout from './AuthLayout.jsx';

export default function Register() {
  const { register: registerAccount } = useAuth();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await registerAccount(values);
      toast.success('Welcome to PulseBoard!');
      navigate('/app', { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start monitoring in under a minute"
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
          >
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          label="Name"
          autoComplete="name"
          autoFocus
          error={errors.name?.message}
          {...register('name')}
        />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters"
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
