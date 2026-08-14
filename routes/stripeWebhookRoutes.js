const express = require("express");
const Stripe = require("stripe");
const connectDB = require("../utils/db");
const { ObjectId } = require("mongodb");

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
        const signature = req.headers["stripe-signature"];

        let event;

        try {
            event = stripe.webhooks.constructEvent(
                req.body,
                signature,
                process.env.STRIPE_WEBHOOK_SECRET
            );
        } catch (error) {
            console.error(
                "Stripe webhook signature verification failed:",
                error.message
            );

            return res.status(400).send(
                `Webhook Error: ${error.message}`
            );
        }

        try {
            if (event.type === "checkout.session.completed") {
                const session = event.data.object;

                if (
                    session.metadata?.type !==
                    "credit_purchase"
                ) {
                    return res.status(200).json({
                        received: true,
                    });
                }

                const userId = session.metadata.userId;
                const credits = Number(
                    session.metadata.credits
                );

                if (
                    !userId ||
                    !ObjectId.isValid(userId) ||
                    !Number.isInteger(credits) ||
                    credits <= 0
                ) {
                    console.error(
                        "Invalid credit purchase metadata."
                    );

                    return res.status(400).json({
                        message:
                            "Invalid credit purchase metadata.",
                    });
                }

                const db = await connectDB();
                const usersCollection =
                    db.collection("users");

                const result =
                    await usersCollection.updateOne(
                        {
                            _id: new ObjectId(userId),
                        },
                        {
                            $inc: {
                                credits,
                            },
                            $set: {
                                updatedAt: new Date(),
                            },
                        }
                    );

                if (result.matchedCount === 0) {
                    console.error(
                        "User not found:",
                        userId
                    );

                    return res.status(404).json({
                        message: "User not found.",
                    });
                }

                console.log(
                    `Added ${credits} credits to user ${userId}.`
                );
            }

            return res.status(200).json({
                received: true,
            });
        } catch (error) {
            console.error(
                "Stripe webhook processing error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to process Stripe webhook.",
            });
        }
    }
);

module.exports = router;
