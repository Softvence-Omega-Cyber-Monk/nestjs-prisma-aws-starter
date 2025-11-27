export const passwordResetConfirmationTemplate = (message: string) => `
<div style="font-family: Arial, sans-serif; background-color: #f4f4f7; padding: 30px;">
  <div style="max-width: 550px; margin: auto; background-color: #ffffff; padding: 35px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
    
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 25px;">
      <h2 style="color: #2c3e50; margin: 0; font-size: 24px;">✅ Password Reset Successful</h2>
    </div>

    <!-- Message -->
    <p style="font-size: 16px; color: #444; line-height: 1.6; margin-bottom: 25px;">
      ${message}
    </p>

    <!-- Security Reminder -->
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin-bottom: 20px;">
      If you did not initiate this change, please reset your password immediately to secure your account.
    </p>

    <!-- Footer -->
    <hr style="border:none; border-top:1px solid #eee; margin: 25px 0;">
    <p style="font-size: 13px; color: #999; text-align: center; margin: 0;">
      Need help? Contact our support team.  
    </p>

  </div>
</div>
`;
