import { emailService } from "../services/email/email.service.js";

async function main() {
  const recipient = process.argv[2];

  if (!recipient || !recipient.includes("@")) {
    console.error("Usage: npm run email:test <recipient-email-address>");
    process.exit(1);
  }

  console.log(`Sending non-auth test email to ${recipient}...`);

  const success = await emailService.sendEmail({
    to: recipient,
    subject: "MyPetMart SMTP Integration Test",
    text: "This is a simple non-auth test message to verify the MyPetMart SMTP configuration.",
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background: #fff5e9; border-radius: 16px; color: #35221b;">
        <h2 style="color: #d65e2a; margin-top: 0;">SMTP Test Successful</h2>
        <p style="font-size: 16px; line-height: 1.5;">Your SMTP configuration is correctly integrated with Nodemailer.</p>
        <hr style="border: 0; border-top: 1px solid #e5d5c5; margin: 24px 0;" />
        <p style="font-size: 12px; color: #888;">This is a test notification. No action is required.</p>
      </div>
    `
  });

  if (success) {
    console.log("Test email sent successfully!");
    process.exit(0);
  } else {
    console.error("Error: Failed to send test email. Check logs for details.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error running email-test script:", error);
  process.exit(1);
});
