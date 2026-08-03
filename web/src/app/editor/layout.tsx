import { ViewportLock } from '@/components/layout/ViewportLock';

/**
 * The editor owns the full viewport and scrolls only inside its own panels.
 * The scroll lock lives here (and on /dev, the auth-bypass editor) rather than
 * on `body`, so public pages keep a working scrollbar — see ViewportLock.
 */
export default function EditorRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ViewportLock>{children}</ViewportLock>;
}
