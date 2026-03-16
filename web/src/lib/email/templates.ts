const BRAND_BG = "#0f0f0f";
const BRAND_SURFACE = "#1a1a1a";
const BRAND_ACCENT = "#7c3aed";
const BRAND_TEXT = "#e5e5e5";
const BRAND_MUTED = "#a3a3a3";


function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:${BRAND_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND_BG};padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:${BRAND_SURFACE};border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
          <tr>
            <td style="background-color:${BRAND_ACCENT};padding:24px 32px;">
              <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">SpawnForge</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:${BRAND_TEXT};">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #2a2a2a;">
              <p style="margin:0;font-size:12px;color:${BRAND_MUTED};">
                SpawnForge &mdash; AI-native game development platform.<br />
                You received this email because of activity on your account.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function h1(text: string): string {
  return `<h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#ffffff;">${text}</h1>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#e5e5e5;">${text}</p>`;
}

function highlight(text: string): string {
  return `<span style="color:#a78bfa;font-weight:600;">${text}</span>`;
}

export function welcomeEmail(userName: string): { subject: string; html: string } {
  const subject = "Welcome to SpawnForge!";
  const html = baseLayout(`
    ${h1("Welcome to SpawnForge!")}
    ${p(`Hi ${highlight(escapeHtml(userName))}, we&apos;re thrilled to have you on board.`)}
    ${p("SpawnForge is your AI-native game development platform. Build 2D and 3D games in your browser using natural language or our visual editor.")}
    ${p("Get started by opening the editor and creating your first scene. If you have any questions, our documentation is available directly inside the editor — just press <strong>F1</strong>.")}
    ${p("Happy building!")}
  `);
  return { subject, html };
}

export function subscriptionConfirmation(tier: string): { subject: string; html: string } {
  const safeTier = escapeHtml(tier);
  const subject = `Your SpawnForge ${safeTier} subscription is active`;
  const html = baseLayout(`
    ${h1("Subscription Confirmed")}
    ${p(`Your ${highlight(safeTier)} plan is now active.`)}
    ${p("You now have access to all features included in your plan. Your billing cycle starts today and will renew automatically each month.")}
    ${p("You can manage your subscription at any time from your account settings.")}
    ${p("Thank you for supporting SpawnForge!")}
  `);
  return { subject, html };
}

export function paymentFailed(userName: string): { subject: string; html: string } {
  const subject = "Action required: Payment failed";
  const html = baseLayout(`
    ${h1("Payment Failed")}
    ${p(`Hi ${highlight(escapeHtml(userName))}, we were unable to process your latest payment.`)}
    ${p("To keep your subscription active and retain access to all features, please update your payment method in your account settings as soon as possible.")}
    ${p("If you believe this is an error or need assistance, please contact our support team.")}
    ${p("We&apos;ll retry the payment in the next few days.")}
  `);
  return { subject, html };
}

export function tokenBalanceLow(
  userName: string,
  remaining: number
): { subject: string; html: string } {
  const subject = "Your SpawnForge token balance is running low";
  const html = baseLayout(`
    ${h1("Low Token Balance")}
    ${p(`Hi ${highlight(escapeHtml(userName))}, your AI token balance is running low.`)}
    ${p(`You have ${highlight(remaining.toLocaleString())} tokens remaining. Once your balance reaches zero, AI-powered features will be paused until your balance is topped up.`)}
    ${p("You can purchase additional tokens or upgrade your plan from your account settings.")}
  `);
  return { subject, html };
}
