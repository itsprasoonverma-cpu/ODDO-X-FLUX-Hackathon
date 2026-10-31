
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

export async function recordPayment(data) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const customer = await tx.customer.findUnique({
            where: { id: data.customerId }
          });

          if (!customer || customer.status !== "ACTIVE") {
            throw new Error("Active customer not found.");
          }

          const paymentAmount = new Prisma.Decimal(data.amount);
          const allocations = data.allocations || [];

          const allocatedTotal = allocations.reduce(
            (total, item) => total.plus(item.amount),
            new Prisma.Decimal(0)
          );

          if (allocatedTotal.greaterThan(paymentAmount)) {
            throw new Error(
              "Allocated amount cannot exceed payment amount."
            );
          }

          // Validate all invoices before recording payment.
          const invoiceUpdates = [];

          for (const allocation of allocations) {
            const invoice = await tx.invoice.findUnique({
              where: { id: allocation.invoiceId }
            });

            if (!invoice) {
              throw new Error(
                `Invoice ${allocation.invoiceId} was not found.`
              );
            }

            if (invoice.customerId !== data.customerId) {
              throw new Error(
                "Invoice does not belong to this customer."
              );
            }

            if (["VOID", "DRAFT"].includes(invoice.status)) {
              throw new Error(
                "Payment cannot be allocated to a draft or void invoice."
              );
            }

            const allocationAmount = new Prisma.Decimal(
              allocation.amount
            );

            if (allocationAmount.greaterThan(invoice.balanceDue)) {
              throw new Error(
                `Allocation exceeds balance due for ${invoice.invoiceNumber}.`
              );
            }

            invoiceUpdates.push({
              invoice,
              allocationAmount
            });
          }

          const payment = await tx.payment.create({
            data: {
              customerId: data.customerId,
              amount: paymentAmount,
              currency: "INR",
              method: data.method,
              transactionId: data.transactionId || null,
              paymentDate: data.paymentDate || new Date(),
              notes: data.notes || null
            }
          });

          // Allocate payment and update invoice balances.
          for (const item of invoiceUpdates) {
            const newAmountPaid = new Prisma.Decimal(
              item.invoice.amountPaid
            ).plus(item.allocationAmount);

            const newBalanceDue = new Prisma.Decimal(
              item.invoice.totalAmount
            ).minus(newAmountPaid);

            const newStatus = newBalanceDue.isZero()
              ? "PAID"
              : "PARTIALLY_PAID";

            await tx.paymentAllocation.create({
              data: {
                paymentId: payment.id,
                invoiceId: item.invoice.id,
                amount: item.allocationAmount
              }
            });

            await tx.invoice.update({
              where: { id: item.invoice.id },
              data: {
                amountPaid: newAmountPaid,
                balanceDue: newBalanceDue,
                status: newStatus
              }
            });
          }

          return tx.payment.findUnique({
            where: { id: payment.id },
            include: {
              customer: true,
              allocations: {
                include: {
                  invoice: true
                }
              }
            }
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      );
    } catch (error) {
      // Retry only when PostgreSQL reports a transaction conflict.
      if (error.code === "P2034" && attempt < maxAttempts) {
        console.log(
          `Payment transaction conflict. Retrying (${attempt + 1}/${maxAttempts})...`
        );
        continue;
      }

      throw error;
    }
  }
}

