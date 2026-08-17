import { emailService } from "../services/email/email.service.js";

async function main() {
  console.log("Verifying SMTP configuration...");
  const { environmentConfig } = await import("../config/environment.config.js");
  console.log("Loaded SMTP Host:", environmentConfig.SMTP_HOST);
  console.log("Loaded SMTP Port:", environmentConfig.SMTP_PORT);
  console.log("Loaded SMTP Secure:", environmentConfig.SMTP_SECURE);
  console.log("Loaded SMTP User:", environmentConfig.SMTP_USER);
  console.log("Is SMTP Pass present:", !!environmentConfig.SMTP_PASS);
  if (!emailService.hasTransporter()) {
    console.error("Error: SMTP transporter is not configured. Check your environment variables.");
    process.exit(1);
  }

  const isConnected = await emailService.verify();
  if (isConnected) {
    console.log("SMTP configuration is valid and connection was successful!");
    process.exit(0);
  } else {
    console.error("Error: Failed to connect or authenticate with SMTP host.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error running email-check script:", error);
  process.exit(1);
});
