import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import LandingPage from './(marketing)/page';

export default async function Home() {
  const { userId } = await auth();
  if (userId) {
    redirect('/dashboard');
  }
  return <LandingPage />;
}
