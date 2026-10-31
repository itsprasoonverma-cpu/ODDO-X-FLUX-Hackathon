
import cron from "node-cron";
import { prisma } from "../config/prisma.js";
import { generateInvoice } from "./invoiceService.js";

export async function processDueSubscriptions() {
  console.log("Checking subscriptions due for billing...");

  const now = new Date();

  const dueSubscriptions = await prisma.subscription.findMany({
    where: {
      status: {
        in: ["TRIAL", "ACTIVE"]
      },
      nextBillingDate: {
        lte: now
      },
      cancelAtPeriodEnd: false
    },
    select: {
      id: true
    }
  });

  console.log(
    `Found ${dueSubscriptions.length} subscription(s) due.`
  );

  for (const subscription of dueSubscriptions) {
    try {
      const result = await generateInvoice(subscription.id);

      if (result.alreadyGenerated) {
        console.log(
          `Invoice already exists for ${subscription.id}`
        );
      } else {
        console.log(
          `Invoice generated: ${result.invoice.invoiceNumber}`
        );
      }
    } catch (error) {
      console.error(
        `Billing failed for ${subscription.id}:`,
        error.message
      );
    }
  }
}

export function startBillingScheduler() {
  // Run once when the server starts.
  processDueSubscriptions().catch(error => {
    console.error("Initial billing check failed:", error);
  });

  // Run every day at 00:05 India time.
  cron.schedule(
    "5 0 * * *",
    () => {
      processDueSubscriptions().catch(error => {
        console.error("Scheduled billing check failed:", error);
      });
    },
    {
      timezone: "Asia/Kolkata"
    }
  );

  console.log("Automatic billing scheduler started.");
}

