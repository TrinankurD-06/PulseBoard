import { useQuery } from '@tanstack/react-query';
import { http } from './http.js';

/** Server settings that affect the UI (e.g. the minimum check interval in DEMO_MODE). */
export function useAppMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: () => http.get('/meta').then((res) => res.data.data),
    staleTime: Infinity,
  });
}
