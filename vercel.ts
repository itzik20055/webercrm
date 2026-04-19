import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    {
      path: "/api/cron/followup-reminders",
      schedule: "*/5 * * * *",
    },
  ],
};
