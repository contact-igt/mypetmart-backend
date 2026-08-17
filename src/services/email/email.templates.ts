export function getEmailVerificationTemplate(otp: string, ttlMinutes: number): { subject: string; text: string; html: string } {
  const subject = "Verify your MyPetMart email";
  const text = `Verify your email\n\nYour verification code is:\n\n${otp}\n\nThis code expires in ${ttlMinutes} minutes.\n\nIf you did not create a MyPetMart account, you can safely ignore this email.`;
  const html = `
    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background: #fff5e9; border-radius: 16px; color: #35221b;">
      <h2 style="color: #d65e2a; margin-top: 0; font-family: 'Baloo 2', sans-serif;">MyPetMart</h2>
      <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Verify your email</p>
      <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Your verification code is:</p>
      <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #bb5036; background: #ffffff; padding: 16px; border-radius: 12px; text-align: center; margin: 20px 0; border: 1px solid #e5d5c5;">
        ${otp}
      </div>
      <p style="font-size: 14px; color: #35221b;">This code expires in ${ttlMinutes} minutes.</p>
      <hr style="border: 0; border-top: 1px solid #e5d5c5; margin: 24px 0;" />
      <p style="font-size: 12px; color: #888;">If you did not create a MyPetMart account, you can safely ignore this email.</p>
    </div>
  `;
  return { subject, text, html };
}

export function getPasswordResetTemplate(otp: string, ttlMinutes: number): { subject: string; text: string; html: string } {
  const subject = "Reset your MyPetMart password";
  const text = `We received a request to reset your password.\n\nYour verification code is:\n\n${otp}\n\nThis code expires in ${ttlMinutes} minutes.\n\nIf you did not request a password reset, you can ignore this email.`;
  const html = `
    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background: #fff5e9; border-radius: 16px; color: #35221b;">
      <h2 style="color: #d65e2a; margin-top: 0; font-family: 'Baloo 2', sans-serif;">MyPetMart</h2>
      <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Reset your password</p>
      <p style="font-size: 14px; line-height: 1.5; color: #35221b;">We received a request to reset your password. Your verification code is:</p>
      <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #bb5036; background: #ffffff; padding: 16px; border-radius: 12px; text-align: center; margin: 20px 0; border: 1px solid #e5d5c5;">
        ${otp}
      </div>
      <p style="font-size: 14px; color: #35221b;">This code expires in ${ttlMinutes} minutes.</p>
      <hr style="border: 0; border-top: 1px solid #e5d5c5; margin: 24px 0;" />
      <p style="font-size: 12px; color: #888;">If you did not request a password reset, you can ignore this email.</p>
    </div>
  `;
  return { subject, text, html };
}

export function getPasswordChangedTemplate(): { subject: string; text: string; html: string } {
  const subject = "Your MyPetMart password was changed";
  const text = `Your MyPetMart account password was successfully changed.\n\nIf you made this change, no action is required.\n\nIf you did not make this change, contact MyPetMart support immediately.`;
  const html = `
    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background: #fff5e9; border-radius: 16px; color: #35221b;">
      <h2 style="color: #d65e2a; margin-top: 0; font-family: 'Baloo 2', sans-serif;">MyPetMart</h2>
      <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Your password was changed</p>
      <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Your MyPetMart account password was successfully changed.</p>
      <p style="font-size: 14px; color: #35221b;">If you made this change, no action is required.</p>
      <hr style="border: 0; border-top: 1px solid #e5d5c5; margin: 24px 0;" />
      <p style="font-size: 12px; color: #888;">If you did not make this change, contact MyPetMart support immediately.</p>
    </div>
  `;
  return { subject, text, html };
}
