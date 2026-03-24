export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen overflow-y-auto bg-zinc-950 text-zinc-100">
      {children}
    </div>
  );
}
