
import { randomUUID } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { calculateInvoiceAmounts } from "../utils/invoiceCalculator.js";

function addMonths(date, months) {
  const result = new Date(date);
  const originalDay = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const lastDay = new Date(
    Date.UTC(
      result.getUTCFullYear(),
      result.getUTCMonth() + 1,
      0
    )
  ).getUTCDate();

  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

function getBillingMonths(interval) {
  return {
    MONTHLY: 1,
    QUARTERLY: 3,
    HALF_YEARLY: 6,
    YEARLY: 12
  }[interval];
}

export async function generateInvoice(subscriptionId, now = new Date())  {
  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        customer: true,
        plan: {
          include: { product: true }
        }
      }
    });

    if (!subscription) {
      throw new Error("Subscription not found.");
    }

    if (!["TRIAL", "ACTIVE"].includes(subscription.status)) {
      throw new Error("Subscription is not eligible for billing.");
    }

    if (
      !subscription.nextBillingDate ||
      subscription.nextBillingDate > now
    ) {
      throw new Error("Subscription is not due for billing.");
    }

    if (subscription.customer.status !== "ACTIVE") {
      throw new Error("Customer is inactive.");
    }

    const periodStart = subscription.currentPeriodStart;
    const periodEnd = subscription.currentPeriodEnd;

    const existingInvoice = await tx.invoice.findUnique({
      where: {
        subscriptionId_billingPeriodStart: {
          subscriptionId,
          billingPeriodStart: periodStart
        }
      }
    });

    if (existingInvoice) {
      return {
        alreadyGenerated: true,
        invoice: existingInvoice
      };
    }

    const amounts = calculateInvoiceAmounts(
      subscription.price,
      subscription.gstRate
    );

    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setUTCDate(dueDate.getUTCDate() + 7);

    const year = issueDate.getUTCFullYear();
    const invoiceNumber =
      `BL-INV-${year}-${randomUUID().slice(0, 8).toUpperCase()}`;

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        customerId: subscription.customerId,
        subscriptionId,

        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,

        issueDate,
        dueDate,

        currency: "INR",

        ...amounts,

        lines: {
          create: {
            description: subscription.plan.name,
            hsnSac: subscription.plan.product.hsnSac,
            quantity: 1,
            unitPrice: subscription.price,
            gstRate: subscription.gstRate,
            taxableAmount: amounts.subtotal,
            taxAmount: amounts.taxAmount,
            totalAmount: amounts.totalAmount
          }
        }
      },
      include: { lines: true }
    });

    const billingMonths = getBillingMonths(
      subscription.billingInterval
    );

    if (!billingMonths) {
      throw new Error("Unsupported billing interval.");
    }

    const nextPeriodStart = periodEnd;
    const nextPeriodEnd = addMonths(
      nextPeriodStart,
      billingMonths
    );

    await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: "ACTIVE",
        currentPeriodStart: nextPeriodStart,
        currentPeriodEnd: nextPeriodEnd,
        nextBillingDate: nextPeriodStart,
        trialEndsAt: null
      }
    });

    return {
      alreadyGenerated: false,
      invoice
    };
  });
}

