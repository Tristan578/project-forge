import { cacheLife, cacheTag } from 'next/cache';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalLayout } from '@/components/legal/LegalLayout';

export const metadata: Metadata = {
  title: 'Terms of Service - SpawnForge',
  description: 'SpawnForge Terms of Service - AI-Powered Game Creation Platform',
  alternates: { canonical: '/terms' },
};

const tableOfContents = [
  { id: 'acceptance', label: 'Acceptance of Terms' },
  { id: 'description', label: 'Description of Service' },
  { id: 'accounts', label: 'Account Registration' },
  { id: 'subscriptions', label: 'Subscriptions & Billing' },
  { id: 'user-content', label: 'User Content' },
  { id: 'ai-content', label: 'AI-Generated Content' },
  { id: 'acceptable-use', label: 'Acceptable Use' },
  { id: 'intellectual-property', label: 'Intellectual Property' },
  { id: 'third-party', label: 'Third-Party Services' },
  { id: 'disclaimers', label: 'Disclaimers' },
  { id: 'limitation', label: 'Limitation of Liability' },
  { id: 'indemnification', label: 'Indemnification' },
  { id: 'termination', label: 'Termination' },
  { id: 'governing-law', label: 'Governing Law' },
  { id: 'changes', label: 'Changes to Terms' },
  { id: 'contact', label: 'Contact Information' },
];

export default async function TermsOfServicePage() {
  'use cache';
  cacheLife('days');
  cacheTag('terms');
  return (
    <LegalLayout
      title="Terms of Service"
      lastUpdated="February 27, 2026"
      tableOfContents={tableOfContents}
    >
      {/* 1. Acceptance of Terms */}
      <section id="acceptance">
        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using SpawnForge (&quot;the Service&quot;), operated by SpawnForge
          (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), you agree to be bound by these Terms of
          Service (&quot;Terms&quot;). If you do not agree to all of these Terms, you may not
          access or use the Service.
        </p>
        <p>
          These Terms apply to all visitors, registered users, and subscribers of the
          Service. By creating an account or using any part of the Service, you
          acknowledge that you have read, understood, and agree to be bound by these
          Terms and our{' '}
          <Link href="/privacy">Privacy Policy</Link>, which is incorporated herein
          by reference.
        </p>
        <p>
          You must be at least 13 years of age to use the Service. If you are under 18,
          you represent that you have your parent or legal guardian&apos;s permission to use
          the Service and that they have read and agree to these Terms on your behalf.
        </p>
      </section>

      {/* 2. Description of Service */}
      <section id="description">
        <h2>2. Description of Service</h2>
        <p>
          SpawnForge is a web-based, AI-powered game creation platform that allows users
          to build 2D and 3D games through natural language interaction and a visual
          editor. The Service includes, but is not limited to:
        </p>
        <ul>
          <li>A browser-based game editor with real-time 3D rendering</li>
          <li>AI-assisted game creation and scene editing via natural language</li>
          <li>AI-powered asset generation (3D models, textures, sound effects, music, voice)</li>
          <li>Visual scripting and TypeScript-based game scripting</li>
          <li>Game export and cloud publishing capabilities</li>
          <li>Cloud project storage and management</li>
          <li>A community marketplace for sharing and discovering games</li>
        </ul>
        <p>
          We reserve the right to modify, suspend, or discontinue any aspect of the
          Service at any time, with or without notice.
        </p>
      </section>

      {/* 3. Account Registration */}
      <section id="accounts">
        <h2>3. Account Registration</h2>
        <p>
          To access certain features of the Service, you must create an account. When
          you register, you agree to:
        </p>
        <ul>
          <li>
            Provide accurate, current, and complete information during registration
          </li>
          <li>
            Maintain and promptly update your account information to keep it accurate
          </li>
          <li>
            Maintain the security and confidentiality of your login credentials
          </li>
          <li>
            Accept responsibility for all activities that occur under your account
          </li>
          <li>
            Notify us immediately of any unauthorized use of your account
          </li>
        </ul>
        <p>
          We reserve the right to suspend or terminate accounts that violate these Terms
          or that we reasonably believe are being used fraudulently.
        </p>
      </section>

      {/* 4. Subscriptions & Billing */}
      <section id="subscriptions">
        <h2>4. Subscriptions and Billing</h2>
        <p>
          SpawnForge offers both free and paid subscription tiers. By subscribing to a
          paid plan, you agree to the following:
        </p>

        <h3>4.1 Subscription Plans</h3>
        <p>
          The features, limits, and pricing of each subscription tier are described on
          our{' '}
          <Link href="/pricing">Pricing page</Link>. We reserve the right to change
          pricing and plan features upon 30 days&apos; written notice to subscribers.
        </p>

        <h3>4.2 Payment</h3>
        <p>
          All payments are processed through Stripe, a third-party payment processor.
          By providing your payment information, you authorize us to charge your
          selected payment method for the applicable subscription fees on a recurring
          basis. You agree to Stripe&apos;s{' '}
          <a
            href="https://stripe.com/legal"
            target="_blank"
            rel="noopener noreferrer"
          >
            terms of service
          </a>{' '}
          as they relate to payment processing.
        </p>

        <h3>4.3 Billing Cycle</h3>
        <p>
          Subscriptions are billed monthly. Your billing cycle begins on the date you
          subscribe and renews automatically on the same date each month unless
          cancelled.
        </p>

        <h3>4.4 Cancellation</h3>
        <p>
          You may cancel your subscription at any time through your account settings.
          Upon cancellation, you will retain access to your paid features until the end
          of your current billing period. No refunds are provided for partial billing
          periods.
        </p>

        <h3>4.5 AI Token Credits</h3>
        <p>
          Certain subscription tiers include AI token credits for use with platform AI
          features. Unused token credits do not roll over between billing periods. Token
          usage and balances are tracked in your account dashboard.
        </p>
      </section>

      {/* 5. User Content */}
      <section id="user-content">
        <h2>5. User Content</h2>

        <h3>5.1 Ownership</h3>
        <p>
          You retain all ownership rights to the content you create using SpawnForge,
          including game projects, scripts, scene configurations, and any original
          assets you upload (&quot;User Content&quot;). SpawnForge does not claim ownership of
          your User Content.
        </p>

        <h3>5.2 License to SpawnForge</h3>
        <p>
          By uploading or creating User Content on the Service, you grant SpawnForge a
          non-exclusive, worldwide, royalty-free license to host, store, display, and
          transmit your User Content solely for the purpose of operating, maintaining,
          and providing the Service to you. This license terminates when you delete your
          User Content or close your account, except for content that has been shared
          publicly or with other users.
        </p>

        <h3>5.3 Published Games</h3>
        <p>
          When you publish a game through SpawnForge&apos;s cloud publishing feature, you
          grant SpawnForge the right to host and serve that game to end users at the
          published URL. You may unpublish your game at any time.
        </p>

        <h3>5.4 Responsibility</h3>
        <p>
          You are solely responsible for your User Content and the consequences of
          publishing it. You represent and warrant that you own or have the necessary
          rights to all content you upload or create on the platform.
        </p>
      </section>

      {/* 6. AI-Generated Content */}
      <section id="ai-content">
        <h2>6. AI-Generated Content</h2>

        <h3>6.1 Ownership of AI Outputs</h3>
        <p>
          Content generated by AI features within SpawnForge (including but not limited to
          3D models, textures, sound effects, music, voice lines, and scene
          configurations) is provided for your use within the Service. To the extent
          permitted by applicable law, you are granted a license to use AI-generated
          content in your projects, including for commercial purposes.
        </p>

        <h3>6.2 No Guarantees</h3>
        <p>
          AI-generated content is provided &quot;as is.&quot; We do not guarantee the accuracy,
          quality, originality, or fitness for any particular purpose of AI-generated
          outputs. AI outputs may occasionally produce content that resembles existing
          copyrighted works; you are responsible for reviewing AI-generated content
          before use.
        </p>

        <h3>6.3 Third-Party AI Providers</h3>
        <p>
          AI asset generation features are powered by third-party providers. Your use of
          these features is also subject to the applicable terms of service of those
          providers. SpawnForge is not responsible for the output or behavior of
          third-party AI services.
        </p>

        <h3>6.4 BYOK (Bring Your Own Keys)</h3>
        <p>
          Certain subscription tiers allow you to use your own API keys for AI
          services. When using BYOK, you are responsible for managing your API keys, any
          charges incurred with the third-party provider, and compliance with that
          provider&apos;s terms of service. SpawnForge encrypts stored API keys but is not
          liable for charges incurred through your keys.
        </p>
      </section>

      {/* 7. Acceptable Use */}
      <section id="acceptable-use">
        <h2>7. Acceptable Use</h2>
        <p>You agree not to use the Service to:</p>
        <ul>
          <li>
            Violate any applicable laws, regulations, or third-party rights
          </li>
          <li>
            Create, distribute, or publish content that is unlawful, harmful,
            threatening, abusive, defamatory, obscene, or otherwise objectionable
          </li>
          <li>
            Infringe on the intellectual property rights of others
          </li>
          <li>
            Distribute malware, viruses, or other harmful code through published games
          </li>
          <li>
            Attempt to gain unauthorized access to the Service, other accounts, or
            computer systems
          </li>
          <li>
            Circumvent or manipulate subscription limits, token quotas, or usage
            restrictions
          </li>
          <li>
            Use the AI features to generate content that violates the acceptable use
            policies of the underlying AI providers
          </li>
          <li>
            Scrape, data mine, or use automated tools to access the Service in a manner
            not authorized by SpawnForge
          </li>
          <li>
            Interfere with or disrupt the Service or its infrastructure
          </li>
          <li>
            Impersonate another person or entity
          </li>
        </ul>
        <p>
          We reserve the right to investigate and take appropriate action against anyone
          who, in our sole discretion, violates this section, including removing content,
          suspending accounts, and reporting violations to law enforcement.
        </p>
      </section>

      {/* 8. Intellectual Property */}
      <section id="intellectual-property">
        <h2>8. Intellectual Property</h2>
        <p>
          The Service, including its original content (excluding User Content), features,
          and functionality, is owned by SpawnForge and is protected by international
          copyright, trademark, patent, trade secret, and other intellectual property
          laws.
        </p>
        <p>
          The SpawnForge name, logo, and all related names, logos, product and service
          names, designs, and slogans are trademarks of SpawnForge. You may not use such
          marks without our prior written permission.
        </p>
        <p>
          The game engine technology, editor interface, AI orchestration systems, MCP
          command framework, and all proprietary tools and libraries within the Service
          remain the exclusive property of SpawnForge.
        </p>
      </section>

      {/* 9. Third-Party Services */}
      <section id="third-party">
        <h2>9. Third-Party Services</h2>
        <p>
          The Service integrates with various third-party services to provide its
          functionality. These include, but are not limited to:
        </p>
        <ul>
          <li>
            <strong>Clerk</strong> for authentication and user management
          </li>
          <li>
            <strong>Stripe</strong> for payment processing and subscription management
          </li>
          <li>
            <strong>Third-party AI providers</strong> for asset generation (3D models,
            textures, audio, music, voice)
          </li>
        </ul>
        <p>
          Your use of these third-party services is subject to their respective terms of
          service and privacy policies. SpawnForge is not responsible for the practices or
          policies of third-party service providers.
        </p>
      </section>

      {/* 10. Disclaimers */}
      <section id="disclaimers">
        <h2>10. Disclaimers</h2>
        <p>
          THE SERVICE IS PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; BASIS, WITHOUT
          WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
          TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
          AND NON-INFRINGEMENT.
        </p>
        <p>
          SpawnForge does not warrant that the Service will be uninterrupted, secure,
          or error-free; that defects will be corrected; or that the Service or the
          servers that make it available are free of viruses or other harmful components.
        </p>
        <p>
          Games created and exported through SpawnForge are provided without warranty.
          SpawnForge does not guarantee the performance, compatibility, or functionality
          of exported games on any particular platform or browser.
        </p>
      </section>

      {/* 11. Limitation of Liability */}
      <section id="limitation">
        <h2>11. Limitation of Liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL
          SPAWNFORGE, ITS DIRECTORS, EMPLOYEES, PARTNERS, AGENTS, SUPPLIERS, OR
          AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
          PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION LOSS OF PROFITS, DATA, USE,
          GOODWILL, OR OTHER INTANGIBLE LOSSES, RESULTING FROM:
        </p>
        <ol>
          <li>Your access to, use of, or inability to access or use the Service</li>
          <li>Any conduct or content of any third party on the Service</li>
          <li>Any content obtained from the Service, including AI-generated content</li>
          <li>Unauthorized access, use, or alteration of your transmissions or content</li>
          <li>Loss or corruption of User Content, game projects, or exported games</li>
        </ol>
        <p>
          IN NO EVENT SHALL SPAWNFORGE&apos;S TOTAL LIABILITY TO YOU FOR ALL CLAIMS ARISING
          FROM OR RELATING TO THE SERVICE EXCEED THE AMOUNT YOU HAVE PAID TO SPAWNFORGE
          IN THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR
          ONE HUNDRED DOLLARS ($100), WHICHEVER IS GREATER.
        </p>
      </section>

      {/* 12. Indemnification */}
      <section id="indemnification">
        <h2>12. Indemnification</h2>
        <p>
          You agree to defend, indemnify, and hold harmless SpawnForge and its officers,
          directors, employees, and agents from and against any claims, liabilities,
          damages, losses, and expenses (including reasonable attorney&apos;s fees) arising
          out of or in any way connected with:
        </p>
        <ul>
          <li>Your access to or use of the Service</li>
          <li>Your User Content or published games</li>
          <li>Your violation of these Terms</li>
          <li>Your violation of any third-party rights, including intellectual property rights</li>
        </ul>
      </section>

      {/* 13. Termination */}
      <section id="termination">
        <h2>13. Termination</h2>
        <p>
          We may terminate or suspend your account and access to the Service
          immediately, without prior notice or liability, for any reason, including
          without limitation if you breach these Terms.
        </p>
        <p>
          Upon termination, your right to use the Service will immediately cease. If you
          wish to terminate your account, you may do so through your account settings or
          by contacting us.
        </p>
        <p>
          Upon account termination, we will make reasonable efforts to allow you to
          export your User Content for a period of 30 days. After this period, we
          reserve the right to delete all data associated with your account.
        </p>
        <p>
          The following sections survive termination: User Content (Section 5.2 for
          published content), Disclaimers, Limitation of Liability, Indemnification,
          and Governing Law.
        </p>
      </section>

      {/* 14. Governing Law */}
      <section id="governing-law">
        <h2>14. Governing Law</h2>
        <p>
          These Terms shall be governed by and construed in accordance with the laws of
          the State of Delaware, United States, without regard to its conflict of law
          provisions.
        </p>
        <p>
          Any dispute arising from or relating to these Terms or the Service shall be
          resolved through binding arbitration administered by the American Arbitration
          Association in accordance with its Commercial Arbitration Rules. The
          arbitration shall take place in Delaware, and the language shall be English.
        </p>
        <p>
          Notwithstanding the foregoing, either party may seek injunctive or other
          equitable relief in any court of competent jurisdiction to prevent the actual
          or threatened infringement of intellectual property rights.
        </p>
      </section>

      {/* 15. Changes to Terms */}
      <section id="changes">
        <h2>15. Changes to Terms</h2>
        <p>
          We reserve the right to modify or replace these Terms at any time. If a
          revision is material, we will provide at least 30 days&apos; notice prior to any
          new terms taking effect by posting the updated Terms on the Service and, where
          possible, notifying you by email.
        </p>
        <p>
          Your continued use of the Service after the effective date of revised Terms
          constitutes your acceptance of those changes. If you do not agree to the new
          terms, you must stop using the Service.
        </p>
      </section>

      {/* 16. Contact Information */}
      <section id="contact">
        <h2>16. Contact Information</h2>
        <p>
          If you have any questions about these Terms of Service, please contact us at:
        </p>
        <ul>
          <li>
            <strong>Email:</strong> legal@spawnforge.ai
          </li>
          <li>
            <strong>Website:</strong>{' '}
            <a href="https://spawnforge.ai">https://spawnforge.ai</a>
          </li>
        </ul>
      </section>
    </LegalLayout>
  );
}
