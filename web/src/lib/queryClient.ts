import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { UnauthenticatedError } from '@/api'

// One place to handle an expired session: drop the cached user, and the app falls back to the sign-in page.
const onAuthError = (err: unknown) => {
  if (err instanceof UnauthenticatedError) queryClient.setQueryData(['me'], null)
}

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: {
    queries: {
      retry: (n, err) => !(err instanceof UnauthenticatedError) && n < 2,
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    },
  },
})
