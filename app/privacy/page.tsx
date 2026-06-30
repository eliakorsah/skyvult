import type { Metadata } from "next";
import Link from "next/link";
import LegalShell, { Section } from "@/components/LegalShell";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy · SkyVult",
  description: "How SkyVult collects, uses, and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      intro={`This Privacy Policy explains how ${LEGAL.companyName} ("we", "us", "our") collects, uses, and protects your personal data when you use ${LEGAL.appName}. We are committed to handling your data lawfully and transparently under the Data Protection Act, 2012 (Act 843) of ${LEGAL.jurisdiction}.`}
    >
      <Section n={1} title="Information We Collect">
        <p>We collect the following categories of data:</p>
        <ul className="list-disc pl-5 space-y-1 marker:text-muted">
          <li><span className="text-white font-medium">Account data:</span> name, email address, and password (stored only as a secure hash).</li>
          <li><span className="text-white font-medium">Identity (KYC) data:</span> government-issued ID type and number, and the documents you upload for verification.</li>
          <li><span className="text-white font-medium">Financial data:</span> your Mobile Money number, deposit and withdrawal amounts, references, and transaction history. We do not store full card numbers or your Mobile Money PIN.</li>
          <li><span className="text-white font-medium">Usage data:</span> trades placed, balances, referral activity, and support messages.</li>
          <li><span className="text-white font-medium">Technical data:</span> device, browser, IP address, and similar information collected automatically when you use the platform.</li>
        </ul>
      </Section>

      <Section n={2} title="How We Use Your Data">
        <p>We use your data to:</p>
        <ul className="list-disc pl-5 space-y-1 marker:text-muted">
          <li>create and operate your account and process trades;</li>
          <li>process deposits and withdrawals and confirm payments;</li>
          <li>verify your identity and meet our KYC/AML obligations;</li>
          <li>detect, prevent, and investigate fraud and abuse;</li>
          <li>provide support and send service-related notifications;</li>
          <li>comply with legal and regulatory requirements.</li>
        </ul>
      </Section>

      <Section n={3} title="How We Share Your Data">
        <p>
          We do not sell your personal data. We share it only with service providers who help us run the
          platform, and only to the extent needed, including:
        </p>
        <ul className="list-disc pl-5 space-y-1 marker:text-muted">
          <li><span className="text-white font-medium">Payment providers</span> (e.g. Mobile Money operators and payment processors) to process deposits and withdrawals;</li>
          <li><span className="text-white font-medium">Infrastructure & database providers</span> that host the platform and store data securely;</li>
          <li><span className="text-white font-medium">Messaging providers</span> we use for internal operational alerts;</li>
          <li><span className="text-white font-medium">Authorities and regulators</span> where we are legally required to disclose information.</li>
        </ul>
      </Section>

      <Section n={4} title="Data Retention">
        <p>
          We keep your data for as long as your account is active and as long afterwards as needed to meet
          legal, accounting, tax, and AML obligations. KYC and transaction records may be retained for several
          years as required by law even after your account is closed.
        </p>
      </Section>

      <Section n={5} title="Security">
        <p>
          We use technical and organisational measures to protect your data, including password hashing,
          encryption in transit, and restricted access. No system is perfectly secure, so we cannot guarantee
          absolute security. Keep your login credentials confidential and notify us promptly if you suspect
          unauthorised access.
        </p>
      </Section>

      <Section n={6} title="Your Rights">
        <p>
          Subject to applicable law, you may request access to the personal data we hold about you, ask us to
          correct inaccurate data, or request deletion where we are not required to retain it. To exercise
          these rights, contact us at the address below. We may need to verify your identity before acting on
          a request.
        </p>
      </Section>

      <Section n={7} title="Cookies & Local Storage">
        <p>
          We use cookies and browser local storage that are necessary for the platform to work — for example,
          to keep you signed in and remember your preferences. We do not use them to track you across other
          websites.
        </p>
      </Section>

      <Section n={8} title="Children">
        <p>
          {LEGAL.appName} is not intended for anyone under {LEGAL.minAge}. We do not knowingly collect data
          from people under that age, and we will delete such data if we become aware of it.
        </p>
      </Section>

      <Section n={9} title="Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time. Material changes will be notified through the
          platform or by email, and the "last updated" date above will change.
        </p>
      </Section>

      <Section n={10} title="Contact">
        <p>
          For privacy questions or requests, contact:
          <br />
          {LEGAL.companyName}
          {LEGAL.registration ? <> · Reg. {LEGAL.registration}</> : null}
          {LEGAL.address ? <><br />{LEGAL.address}</> : null}
        </p>
        <Link
          href="/support"
          className="inline-flex items-center gap-2 mt-1 px-3.5 py-2 rounded-lg text-sm font-semibold bg-accent text-black hover:bg-accent/90 transition-colors"
        >
          💬 Message Us
        </Link>
      </Section>
    </LegalShell>
  );
}
