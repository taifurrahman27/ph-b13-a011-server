const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./utils/db");

const authRoutes = require("./routes/authRoutes");
const campaignRoutes = require("./routes/campaignRoutes");
const withdrawalRoutes = require("./routes/withdrawalRoutes");
const paymentsRouter = require("./routes/payments");
const paymentRoutes = require("./routes/paymentRoutes");
const stripeWebhookRoutes = require("./routes/stripeWebhookRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
    cors({
        origin: process.env.BETTER_AUTH_URL,
        credentials: true,
    })
);

app.use("/api/stripe", stripeWebhookRoutes);

app.use(express.json());

const startServer = async () => {
    try {
        const db = await connectDB();

        const usersCollection = db.collection("users");
        const campaignsCollection = db.collection("campaigns");
        const withdrawalsCollection = db.collection("withdrawals");
        const contributionsCollection = db.collection("contributions");
        const contributionRoutes = require("./routes/contributionRoutes");

        app.use("/api/auth", authRoutes);

        app.use(
            "/api/campaigns",
            campaignRoutes(
                campaignsCollection,
                usersCollection
            )
        );

        app.use(
            "/api/withdrawals",
            withdrawalRoutes(
                withdrawalsCollection,
                usersCollection
            )
        );

        app.use(
            "/api/payments",
            paymentsRouter(
                campaignsCollection,
                contributionsCollection
            )
        );

        app.use("/api/payments", paymentRoutes);
        app.use("/api/contributions", contributionRoutes);

        app.use("/api/admin", adminRoutes);

        app.get("/", (req, res) => {
            res.send("CrowdFunding server is running");
        });

        app.listen(PORT, () => {
            console.log(
                `CrowdFunding server running on port ${PORT}`
            );
        });
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
};

startServer();
