import { z } from "zod";

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters long")
  .max(191, "Username must be under 191 characters");

const emailSchema = z
  .string()
  .trim()
  .email("Enter a valid email address")
  .max(191, "Email must be under 191 characters");

const currentPasswordSchema = z
  .string()
  .trim()
  .min(8, "Current password must be at least 8 characters long");

const newPasswordSchema = z
  .string()
  .trim()
  .min(12, "New password must be at least 12 characters long");

const accountProfileBaseSchema = z.object({
  username: usernameSchema.optional(),
  email: emailSchema.optional(),
});

export const accountProfileFormSchema = accountProfileBaseSchema.required({
  username: true,
  email: true,
});

export type AccountProfileFormInput = z.infer<typeof accountProfileFormSchema>;

export const accountProfileUpdateSchema = accountProfileBaseSchema.superRefine(
  (data, ctx) => {
    if (data.username === undefined && data.email === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide username or email to update",
        path: ["username"],
      });
    }
  }
);

export type AccountProfileUpdateInput = z.infer<
  typeof accountProfileUpdateSchema
>;

const accountPasswordBaseSchema = z.object({
  currentPassword: currentPasswordSchema,
  newPassword: newPasswordSchema,
  confirmPassword: newPasswordSchema.optional(),
});

type PasswordValidationInput = z.infer<typeof accountPasswordBaseSchema>;

function validateAccountPassword(
  data: PasswordValidationInput,
  ctx: z.RefinementCtx
) {
  if (data.newPassword === data.currentPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["newPassword"],
      message: "New password must be different from current password",
    });
  }

  if (
    data.confirmPassword !== undefined &&
    data.newPassword !== data.confirmPassword
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmPassword"],
      message: "Passwords do not match",
    });
  }
}

export const accountPasswordFormSchema = accountPasswordBaseSchema
  .extend({
    confirmPassword: newPasswordSchema,
  })
  .superRefine(validateAccountPassword);

export type AccountPasswordFormInput = z.infer<
  typeof accountPasswordFormSchema
>;

export const accountPasswordUpdateSchema =
  accountPasswordBaseSchema.superRefine(validateAccountPassword);

export type AccountPasswordUpdateInput = z.infer<
  typeof accountPasswordUpdateSchema
>;
