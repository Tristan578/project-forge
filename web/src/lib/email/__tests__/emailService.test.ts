import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ConsoleEmailProvider,
  getEmailProvider,
  sendEmail,
  type EmailOptions,
} from "../emailService";
import {
  welcomeEmail,
  subscriptionConfirmation,
  paymentFailed,
  tokenBalanceLow,
} from "../templates";

// ---------------------------------------------------------------------------
// ConsoleEmailProvider
// ---------------------------------------------------------------------------

describe("ConsoleEmailProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("logs the email to console", async () => {
    const provider = new ConsoleEmailProvider();
    const options: EmailOptions = {
      to: "user@example.com",
      subject: "Test Subject",
      html: "<p>Hello</p>",
    };

    await provider.send(options);

    expect(console.log).toHaveBeenCalledOnce();
    const [label, payload] = (console.log as ReturnType<typeof vi.spyOn>).mock.calls[0];
    expect(label).toBe("[EmailService] Sending email:");
    expect(payload).toMatchObject({
      to: "user@example.com",
      subject: "Test Subject",
      html: "<p>Hello</p>",
    });
  });

  it("uses default from address when none is provided", async () => {
    const provider = new ConsoleEmailProvider();
    await provider.send({ to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" });

    const payload = (console.log as ReturnType<typeof vi.spyOn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(payload.from).toBe("noreply@spawnforge.ai");
  });

  it("uses provided from address when supplied", async () => {
    const provider = new ConsoleEmailProvider();
    await provider.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>Hi</p>",
      from: "custom@spawnforge.ai",
    });

    const payload = (console.log as ReturnType<typeof vi.spyOn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(payload.from).toBe("custom@spawnforge.ai");
  });

  it("uses provided plain text when supplied", async () => {
    const provider = new ConsoleEmailProvider();
    await provider.send({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi plain",
    });

    const payload = (console.log as ReturnType<typeof vi.spyOn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(payload.text).toBe("Hi plain");
  });

  it("falls back to '(no plain text)' when text is omitted", async () => {
    const provider = new ConsoleEmailProvider();
    await provider.send({ to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" });

    const payload = (console.log as ReturnType<typeof vi.spyOn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(payload.text).toBe("(no plain text)");
  });
});

// ---------------------------------------------------------------------------
// getEmailProvider
// ---------------------------------------------------------------------------

describe("getEmailProvider", () => {
  it("returns an EmailProvider instance", () => {
    const provider = getEmailProvider();
    expect(typeof provider.send).toBe("function");
  });

  it("returns a ConsoleEmailProvider by default", () => {
    const provider = getEmailProvider();
    expect(provider).toBeInstanceOf(ConsoleEmailProvider);
  });
});

// ---------------------------------------------------------------------------
// sendEmail convenience wrapper
// ---------------------------------------------------------------------------

describe("sendEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("delegates to the provider's send method", async () => {
    await sendEmail({ to: "test@example.com", subject: "Hello", html: "<p>Test</p>" });

    expect(console.log).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

describe("welcomeEmail", () => {
  it("returns a non-empty subject", () => {
    const { subject } = welcomeEmail("Alice");
    expect(subject.length).toBeGreaterThan(0);
  });

  it("returns HTML containing the user name", () => {
    const { html } = welcomeEmail("Alice");
    expect(html).toContain("Alice");
  });

  it("returns valid HTML with a doctype", () => {
    const { html } = welcomeEmail("Bob");
    expect(html).toMatch(/<!DOCTYPE html>/i);
  });

  it("includes SpawnForge branding", () => {
    const { html } = welcomeEmail("Bob");
    expect(html).toContain("SpawnForge");
  });
});

describe("subscriptionConfirmation", () => {
  it("returns a non-empty subject including the tier name", () => {
    const { subject } = subscriptionConfirmation("creator");
    expect(subject).toContain("creator");
  });

  it("returns HTML containing the tier name", () => {
    const { html } = subscriptionConfirmation("pro");
    expect(html).toContain("pro");
  });

  it("returns valid HTML with a doctype", () => {
    const { html } = subscriptionConfirmation("hobbyist");
    expect(html).toMatch(/<!DOCTYPE html>/i);
  });

  it("includes SpawnForge branding", () => {
    const { html } = subscriptionConfirmation("starter");
    expect(html).toContain("SpawnForge");
  });
});

describe("paymentFailed", () => {
  it("returns a non-empty subject", () => {
    const { subject } = paymentFailed("Charlie");
    expect(subject.length).toBeGreaterThan(0);
  });

  it("returns HTML containing the user name", () => {
    const { html } = paymentFailed("Charlie");
    expect(html).toContain("Charlie");
  });

  it("returns valid HTML with a doctype", () => {
    const { html } = paymentFailed("Dave");
    expect(html).toMatch(/<!DOCTYPE html>/i);
  });

  it("includes SpawnForge branding", () => {
    const { html } = paymentFailed("Dave");
    expect(html).toContain("SpawnForge");
  });
});

describe("tokenBalanceLow", () => {
  it("returns a non-empty subject", () => {
    const { subject } = tokenBalanceLow("Eve", 500);
    expect(subject.length).toBeGreaterThan(0);
  });

  it("returns HTML containing the user name", () => {
    const { html } = tokenBalanceLow("Eve", 500);
    expect(html).toContain("Eve");
  });

  it("returns HTML containing the remaining token count", () => {
    const { html } = tokenBalanceLow("Eve", 1234);
    // toLocaleString produces "1,234" in en-US; we accept any representation
    expect(html).toMatch(/1[,.]?234/);
  });

  it("returns valid HTML with a doctype", () => {
    const { html } = tokenBalanceLow("Frank", 100);
    expect(html).toMatch(/<!DOCTYPE html>/i);
  });

  it("includes SpawnForge branding", () => {
    const { html } = tokenBalanceLow("Frank", 100);
    expect(html).toContain("SpawnForge");
  });

  it("handles zero remaining tokens", () => {
    const { html } = tokenBalanceLow("Grace", 0);
    expect(html).toContain("0");
  });
});
