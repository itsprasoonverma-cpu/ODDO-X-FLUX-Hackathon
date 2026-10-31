
import express from "express";
import cors from "cors";

import customersRouter from "./routes/customers.js";
import productsRouter from "./routes/products.js";
import healthRouter from "./routes/health.js";
import plansRouter from "./routes/plans.js";
import subscriptionsRouter from "./routes/subscriptions.js";
import invoicesRouter from "./routes/invoices.js";
import paymentsRouter from "./routes/payments.js";
import dashboardRouter from "./routes/dashboard.js";

import {
  errorHandler,
  notFoundHandler
} from "./middleware/errorHandler.js";

export const app = express();

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN?.split(",") ?? true
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

// API home
app.get("/", (req, res) => {
  res.json({
    success: true,
    data: {
      name: "Brightloop API",
      version: "1.0.0"
    }
  });
});

// API routes
app.use("/api/health", healthRouter);
app.use("/api/customers", customersRouter);
app.use("/api/products", productsRouter);
app.use("/api/plans", plansRouter);
app.use("/api/subscriptions", subscriptionsRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/dashboard", dashboardRouter);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

