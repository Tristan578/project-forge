import { useTranslations } from 'next-intl';

/**
 * Thin wrapper around next-intl's useTranslations.
 * Use this hook in all components to keep the dependency abstracted.
 *
 * @param namespace - Optional message namespace (e.g. 'common', 'editor', 'auth')
 * @returns Translation function `t` scoped to the given namespace
 */
type MessageNamespace = 'common' | 'editor' | 'auth';

export function useT(namespace?: MessageNamespace) {
  return useTranslations(namespace);
}
