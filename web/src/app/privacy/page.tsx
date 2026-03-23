import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalLayout } from '@/components/legal/LegalLayout';

export const metadata: Metadata = {
  title: 'Privacy Policy - SpawnForge',
  description: 'SpawnForge Privacy Policy - AI-Powered Game Creation Platform',
};

const tableOfContents = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'information-collected', label: 'Information We Collect' },
  { id: 'how-we-use', label: 'How We Use Your Information' },
  { id: 'third-party-services', label: 'Third-Party Services' },
  { id: 'cookies', label: 'Cookies and Tracking' },
  { id: 'data-retention', label: 'Data Retention' },
  { id: 'user-rights', label: 'Your Rights' },
  { id: 'data-security', label: 'Data Security' },
  { id: 'children', label: "Children's Privacy" },
  { id: 'international', label: 'International Data Transfers' },
  { id: 'changes', label: 'Changes to This Policy' },
  { id: 'contact', label: 'Contact Information' },
];

export default function PrivacyPolicyPage() {
  'use cache';
  return (
    <LegalLayout
      title="Privacy Policy"
      lastUpdated="February 27, 2026"
      tableOfContents={tableOfContents}
    >
      {/* 1. Introduction */}
      <section id="introduction">
        <h2>1. Introduction</h2>
        <p>
          SpawnForge (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) respects your privacy and is committed
          to protecting the personal information you share with us. This Privacy Policy
          explains how we collect, use, disclose, and safeguard your information when
          you use our web-based game creation platform (&quot;the Service&quot;).
        </p>
        <p>
          By using the Service, you consent to the data practices described in this
          policy. If you do not agree with this policy, please do not use the Service.
          This policy should be read alongside our{' '}
          <Link href="/terms">Terms of Service</Link>.
        </p>
      </section>

      {/* 2. Information We Collect */}
      <section id="information-collected">
        <h2>2. Information We Collect</h2>

        <h3>2.1 Account Information</h3>
        <p>
          When you create an account, we collect information provided through our
          authentication provider, Clerk. This may include:
        </p>
        <ul>
          <li>Email address</li>
          <li>Display name</li>
          <li>Profile image (if provided via your authentication method)</li>
          <li>Authentication identifiers</li>
        </ul>

        <h3>2.2 Payment and Billing Data</h3>
        <p>
          When you subscribe to a paid plan, payment information is collected and
          processed by Stripe, our payment processor. SpawnForge does not directly store
          your full credit card number, bank account number, or other sensitive payment
          credentials. We receive from Stripe:
        </p>
        <ul>
          <li>Subscription status and plan tier</li>
          <li>Billing history and invoice records</li>
          <li>Last four digits of your payment method (for display purposes)</li>
          <li>Billing address (if provided)</li>
        </ul>

        <h3>2.3 User Content and Project Data</h3>
        <p>
          We store the content you create on the platform, including:
        </p>
        <ul>
          <li>Game projects, scenes, and scene configurations</li>
          <li>Scripts, visual scripting graphs, and game logic</li>
          <li>Uploaded assets (images, audio files, 3D models)</li>
          <li>AI-generated assets created through the Service</li>
          <li>Published game data</li>
        </ul>

        <h3>2.4 Usage Data</h3>
        <p>
          We automatically collect certain information when you access or use the
          Service, including:
        </p>
        <ul>
          <li>Browser type, version, and rendering capabilities (WebGPU/WebGL2)</li>
          <li>Device type and operating system</li>
          <li>Pages visited within the Service and features used</li>
          <li>Time spent on the Service and session frequency</li>
          <li>AI feature usage and token consumption</li>
          <li>Error logs and performance metrics</li>
          <li>IP address</li>
        </ul>

        <h3>2.5 AI Interaction Data</h3>
        <p>
          When you use AI-powered features (chat-based editing, asset generation), we
          may collect:
        </p>
        <ul>
          <li>Prompts and instructions you provide to AI features</li>
          <li>AI-generated responses and outputs</li>
          <li>Token usage statistics</li>
        </ul>
        <p>
          If you use the BYOK (Bring Your Own Keys) feature, your API keys are
          encrypted at rest using AES-256-GCM encryption. We do not log or inspect the
          content of requests made with your own API keys.
        </p>

        <h3>2.6 Communication Data</h3>
        <p>
          If you contact us for support, provide feedback, or participate in community
          features, we may collect the contents of those communications.
        </p>
      </section>

      {/* 3. How We Use Your Information */}
      <section id="how-we-use">
        <h2>3. How We Use Your Information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>Provide, maintain, and improve the Service</li>
          <li>Process subscriptions, payments, and token credit transactions</li>
          <li>Authenticate your identity and manage your account</li>
          <li>Store and serve your game projects and published games</li>
          <li>Process AI requests and deliver generated assets</li>
          <li>Track AI token usage and enforce subscription tier limits</li>
          <li>Send administrative communications (account confirmations, billing
            notifications, security alerts)</li>
          <li>Analyze usage patterns to improve the Service and user experience</li>
          <li>Detect, prevent, and address technical issues and security threats</li>
          <li>Enforce our Terms of Service and acceptable use policies</li>
          <li>Comply with legal obligations</li>
        </ul>
        <p>
          We do not sell your personal information to third parties. We do not use your
          User Content to train AI models.
        </p>
      </section>

      {/* 4. Third-Party Services */}
      <section id="third-party-services">
        <h2>4. Third-Party Services</h2>
        <p>
          SpawnForge integrates with third-party services that may collect and process your
          data according to their own privacy policies. These services include:
        </p>

        <h3>4.1 Clerk (Authentication)</h3>
        <p>
          We use Clerk for user authentication and session management. Clerk processes
          your login credentials and session tokens. For more information, see{' '}
          <a
            href="https://clerk.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Clerk&apos;s Privacy Policy
          </a>
          .
        </p>

        <h3>4.2 Stripe (Payments)</h3>
        <p>
          We use Stripe to process payments and manage subscriptions. Stripe collects
          and processes your payment information directly. SpawnForge does not have access
          to your full payment card details. For more information, see{' '}
          <a
            href="https://stripe.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Stripe&apos;s Privacy Policy
          </a>
          .
        </p>

        <h3>4.3 AI Service Providers (Asset Generation)</h3>
        <p>
          When you use AI asset generation features, your prompts and certain project
          context may be sent to third-party AI providers for processing. These
          providers include services for:
        </p>
        <ul>
          <li>3D model and texture generation</li>
          <li>Sound effect and voice generation</li>
          <li>Music generation</li>
          <li>Natural language scene editing</li>
        </ul>
        <p>
          Each AI provider has its own privacy practices and data retention policies. We
          send only the minimum information necessary to fulfill your generation
          requests. When using BYOK, requests are made directly with the provider under
          your own account and API terms.
        </p>

        <h3>4.4 Cloud Infrastructure</h3>
        <p>
          The Service is hosted on cloud infrastructure providers. Your data may be
          processed and stored on servers operated by our hosting providers, subject to
          their security practices and certifications.
        </p>
      </section>

      {/* 5. Cookies and Tracking */}
      <section id="cookies">
        <h2>5. Cookies and Tracking Technologies</h2>
        <p>
          The Service uses cookies and similar technologies for the following purposes:
        </p>

        <h3>5.1 Essential Cookies</h3>
        <p>
          These cookies are necessary for the Service to function and cannot be
          disabled. They include:
        </p>
        <ul>
          <li>Authentication session cookies (managed by Clerk)</li>
          <li>Security tokens (CSRF protection)</li>
          <li>User preference settings (editor layout, quality presets)</li>
        </ul>

        <h3>5.2 Functional Cookies</h3>
        <p>
          These cookies enable enhanced functionality, including:
        </p>
        <ul>
          <li>Remembering your editor preferences and workspace layout</li>
          <li>Storing local project data and cached WASM engine binaries</li>
          <li>Theme and display settings</li>
        </ul>

        <h3>5.3 Analytics</h3>
        <p>
          We may use analytics tools to understand how the Service is used. This data
          is collected in aggregate form and does not personally identify individual
          users. You may opt out of non-essential analytics through your browser
          settings.
        </p>
      </section>

      {/* 6. Data Retention */}
      <section id="data-retention">
        <h2>6. Data Retention</h2>
        <p>We retain your information for as long as necessary to fulfill the purposes
          outlined in this policy:</p>
        <ul>
          <li>
            <strong>Account data:</strong> Retained for the duration of your account.
            Upon account deletion, personal data is removed within 30 days, except where
            retention is required by law.
          </li>
          <li>
            <strong>Project and content data:</strong> Retained for the duration of your
            account. Upon account deletion, you will have 30 days to export your
            content before it is permanently deleted.
          </li>
          <li>
            <strong>Payment records:</strong> Retained for a minimum of 7 years to
            comply with tax and financial regulations.
          </li>
          <li>
            <strong>Usage and analytics data:</strong> Retained in aggregate,
            anonymized form indefinitely for service improvement purposes. Identifiable
            usage logs are deleted within 90 days.
          </li>
          <li>
            <strong>AI interaction data:</strong> Prompts and AI responses associated
            with your account are retained for the duration of your account. AI provider
            data retention is governed by each provider&apos;s policies.
          </li>
          <li>
            <strong>Published games:</strong> Remain accessible at their published URLs
            until you unpublish them or your account is terminated.
          </li>
        </ul>
      </section>

      {/* 7. Your Rights */}
      <section id="user-rights">
        <h2>7. Your Rights</h2>
        <p>
          Depending on your jurisdiction, you may have the following rights regarding
          your personal data:
        </p>

        <h3>7.1 Right to Access</h3>
        <p>
          You have the right to request a copy of the personal data we hold about you.
          You can access most of your data directly through your account settings and
          dashboard.
        </p>

        <h3>7.2 Right to Correction</h3>
        <p>
          You have the right to request correction of inaccurate personal data. You can
          update your account information directly through the Service or by contacting
          us.
        </p>

        <h3>7.3 Right to Deletion</h3>
        <p>
          You have the right to request deletion of your personal data. You can delete
          your account through your account settings. Upon deletion, we will remove your
          personal data within 30 days, subject to our data retention obligations.
        </p>

        <h3>7.4 Right to Data Portability</h3>
        <p>
          You have the right to export your data in a machine-readable format. SpawnForge
          provides export functionality for your game projects (as .forge files) and
          game exports (as standalone HTML/JS bundles). You may request a full data
          export by contacting us.
        </p>

        <h3>7.5 Right to Object</h3>
        <p>
          You have the right to object to certain processing of your personal data,
          including processing for direct marketing purposes. You can manage your
          communication preferences through your account settings.
        </p>

        <h3>7.6 Exercising Your Rights</h3>
        <p>
          To exercise any of these rights, contact us at{' '}
          <a href="mailto:privacy@spawnforge.ai">privacy@spawnforge.ai</a>. We will
          respond to your request within 30 days. We may ask you to verify your identity
          before processing your request.
        </p>
      </section>

      {/* 8. Data Security */}
      <section id="data-security">
        <h2>8. Data Security</h2>
        <p>
          We implement appropriate technical and organizational measures to protect your
          personal data against unauthorized access, alteration, disclosure, or
          destruction. These measures include:
        </p>
        <ul>
          <li>Encryption of data in transit using TLS/HTTPS</li>
          <li>Encryption of sensitive data at rest (including BYOK API keys using
            AES-256-GCM)</li>
          <li>Content Security Policy (CSP) headers to prevent cross-site scripting</li>
          <li>Sandboxed script execution environment for user-created game scripts</li>
          <li>Rate limiting and abuse prevention on API endpoints</li>
          <li>Regular security reviews of authentication and authorization flows</li>
          <li>Secure payment processing through PCI-DSS compliant Stripe integration</li>
        </ul>
        <p>
          While we strive to use commercially acceptable means to protect your personal
          data, no method of transmission over the Internet or method of electronic
          storage is 100% secure. We cannot guarantee absolute security.
        </p>
      </section>

      {/* 9. Children's Privacy */}
      <section id="children">
        <h2>9. Children&apos;s Privacy</h2>
        <p>
          The Service is not directed to children under 13 years of age. We do not
          knowingly collect personal information from children under 13. If you are a
          parent or guardian and you are aware that your child has provided us with
          personal information without your consent, please contact us at{' '}
          <a href="mailto:privacy@spawnforge.ai">privacy@spawnforge.ai</a>.
        </p>
        <p>
          If we become aware that we have collected personal information from a child
          under 13 without verification of parental consent, we will take steps to
          remove that information from our servers within a reasonable timeframe.
        </p>
        <p>
          Users between 13 and 18 years of age may use the Service with the consent of
          a parent or legal guardian who agrees to be bound by our Terms of Service and
          this Privacy Policy.
        </p>
      </section>

      {/* 10. International Data Transfers */}
      <section id="international">
        <h2>10. International Data Transfers</h2>
        <p>
          Your information may be transferred to and processed in countries other than
          the country in which you reside. These countries may have data protection laws
          that are different from the laws of your country.
        </p>
        <p>
          When we transfer personal data outside of your jurisdiction, we ensure that
          appropriate safeguards are in place, such as Standard Contractual Clauses
          approved by relevant data protection authorities, or reliance on the
          recipient&apos;s participation in recognized data protection frameworks.
        </p>
        <p>
          By using the Service, you consent to the transfer of your information to the
          United States and other jurisdictions where we and our service providers
          operate.
        </p>
      </section>

      {/* 11. Changes to This Policy */}
      <section id="changes">
        <h2>11. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time to reflect changes in our
          practices, technology, legal requirements, or other factors. When we make
          material changes, we will:
        </p>
        <ul>
          <li>Update the &quot;Last updated&quot; date at the top of this page</li>
          <li>Post a prominent notice on the Service</li>
          <li>Send an email notification to registered users when feasible</li>
        </ul>
        <p>
          We encourage you to review this Privacy Policy periodically. Your continued
          use of the Service after changes are posted constitutes your acceptance of the
          revised policy.
        </p>
      </section>

      {/* 12. Contact Information */}
      <section id="contact">
        <h2>12. Contact Information</h2>
        <p>
          If you have questions, concerns, or requests regarding this Privacy Policy or
          our data practices, please contact us at:
        </p>
        <ul>
          <li>
            <strong>Privacy inquiries:</strong>{' '}
            <a href="mailto:privacy@spawnforge.ai">privacy@spawnforge.ai</a>
          </li>
          <li>
            <strong>General inquiries:</strong>{' '}
            <a href="mailto:legal@spawnforge.ai">legal@spawnforge.ai</a>
          </li>
          <li>
            <strong>Website:</strong>{' '}
            <a href="https://spawnforge.ai">https://spawnforge.ai</a>
          </li>
        </ul>
        <p>
          For data protection inquiries from the European Economic Area, you also have
          the right to lodge a complaint with your local data protection supervisory
          authority.
        </p>
      </section>
    </LegalLayout>
  );
}
