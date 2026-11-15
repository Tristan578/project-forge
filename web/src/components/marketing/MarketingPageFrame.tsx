import { PreLaunchBanner } from './PreLaunchBanner';

export function MarketingPageFrame({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <PreLaunchBanner />
      {children}
    </>
  );
}
