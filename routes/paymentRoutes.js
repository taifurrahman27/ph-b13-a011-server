const express = require("express");
const Stripe = require("stripe");
const connectDB = require("../utils/db");
const verifyToken = require("../middleware/verifyToken");

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const CREDIT_PACKAGES = {
    50: 5,
    100: 10,
    250: 25,
};

router.post(
    "/create-credit-checkout-session",
    verifyToken,
    async (req, res) => {
        try {
            const { credits, amount } = req.body;

            if (!credits || !amount) {
                return res.status(400).json({
                    message: "Credits and amount are required.",
                });
            }

            const numericCredits = Number(credits);
            const numericAmount = Number(amount);

            if (
                !Number.isInteger(numericCredits) ||
                !CREDIT_PACKAGES[numericCredits]
            ) {
                return res.status(400).json({
                    message: "Invalid credit package.",
                });
            }

            const expectedAmount =
                CREDIT_PACKAGES[numericCredits];

            if (numericAmount !== expectedAmount) {
                return res.status(400).json({
                    message: "Invalid credit package amount.",
                });
            }

            const db = await connectDB();
            const usersCollection = db.collection("users");

            const user = await usersCollection.findOne({
                _id: require("mongodb").ObjectId.createFromHexString(
                    req.user.id
                ),
            });

            if (!user) {
                return res.status(404).json({
                    message: "User not found.",
                });
            }

            if (user.role !== "supporter") {
                return res.status(403).json({
                    message:
                        "Only supporters can purchase credits.",
                });
            }

            if (!user.email) {
                return res.status(400).json({
                    message:
                        "User email is required for payment.",
                });
            }

            const clientUrl =
                process.env.CLIENT_URL ||
                "http://localhost:3000";

            const session =
                await stripe.checkout.sessions.create({
                    mode: "payment",

                    payment_method_types: ["card"],

                    customer_email: user.email,

                    line_items: [
                        {
                            price_data: {
                                currency: "usd",

                                product_data: {
                                    name: `${numericCredits} CrowdFunding Credits`,
                                    description:
                                        "Credits for supporting crowdfunding campaigns.",
                                },

                                unit_amount:
                                    numericAmount * 100,
                            },

                            quantity: 1,
                        },
                    ],

                    metadata: {
                        type: "credit_purchase",
                        userId: req.user.id,
                        userEmail: user.email,
                        credits:
                            String(numericCredits),
                        amount:
                            String(numericAmount),
                    },

                    success_url:
                        `${clientUrl}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,

                    cancel_url:
                        `${clientUrl}/dashboard/purchase-credit` +
                        "?payment=cancelled",
                });

            return res.status(200).json({
                message:
                    "Credit checkout session created successfully.",
                url: session.url,
                sessionId: session.id,
            });
        } catch (error) {
            console.error(
                "Create credit checkout session error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to create credit checkout session.",
            });
        }
    }
);

module.exports = router;
