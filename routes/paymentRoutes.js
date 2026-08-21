const express = require("express");
const Stripe = require("stripe");
const { ObjectId } = require("mongodb");

const connectDB = require("../utils/db");
const verifyToken = require("../middleware/verifyToken");

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const CLIENT_URL =
    process.env.CLIENT_URL || "http://localhost:3000";


const CREDIT_PACKAGES = {
    100: {
        credits: 100,
        price: 10,
    },
    300: {
        credits: 300,
        price: 25,
    },
    800: {
        credits: 800,
        price: 60,
    },
    1500: {
        credits: 1500,
        price: 110,
    },
};


router.post(
    "/create-credit-checkout-session",
    verifyToken,
    async (req, res) => {
        try {
            const { credits } = req.body;

            if (!credits) {
                return res.status(400).json({
                    success: false,
                    message: "Credits are required.",
                });
            }

            const selectedPackage =
                CREDIT_PACKAGES[String(credits)];

            if (!selectedPackage) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid credit package.",
                });
            }

            if (!req.user?.id) {
                return res.status(401).json({
                    success: false,
                    message: "Unauthorized.",
                });
            }

            if (!ObjectId.isValid(req.user.id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid user ID.",
                });
            }

            const db = await connectDB();

            const usersCollection = db.collection("users");

            const user = await usersCollection.findOne({
                _id: new ObjectId(req.user.id),
            });

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found.",
                });
            }

            if (user.role !== "supporter") {
                return res.status(403).json({
                    success: false,
                    message:
                        "Only supporters can purchase credits.",
                });
            }


            const session =
                await stripe.checkout.sessions.create({
                    mode: "payment",

                    payment_method_types: ["card"],

                    line_items: [
                        {
                            price_data: {
                                currency: "usd",

                                product_data: {
                                    name: `${selectedPackage.credits} CrowdFunding Credits`,
                                    description:
                                        "CrowdFunding supporter credits",
                                },

                                unit_amount:
                                    selectedPackage.price * 100,
                            },

                            quantity: 1,
                        },
                    ],

                    customer_email: user.email,

                    metadata: {
                        userId: user._id.toString(),
                        userEmail: user.email,
                        userName: user.name || "",
                        credits:
                            selectedPackage.credits.toString(),
                        amount:
                            selectedPackage.price.toString(),
                    },

                    success_url:
                        `${CLIENT_URL}/dashboard/purchase-credit/success` +
                        `?session_id={CHECKOUT_SESSION_ID}`,

                    cancel_url:
                        `${CLIENT_URL}/dashboard/purchase-credit`,
                });

            return res.status(200).json({
                success: true,
                message:
                    "Stripe checkout session created successfully.",

                url: session.url,

                sessionId: session.id,

                credits: selectedPackage.credits,

                amount: selectedPackage.price,
            });
        } catch (error) {
            console.error(
                "Create credit checkout session error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to create Stripe checkout session.",
            });
        }
    }
);


router.post(
    "/confirm-credit-purchase",
    verifyToken,
    async (req, res) => {
        try {
            const { sessionId } = req.body;

            if (!sessionId) {
                return res.status(400).json({
                    success: false,
                    message: "Stripe session ID is required.",
                });
            }

            if (!req.user?.id) {
                return res.status(401).json({
                    success: false,
                    message: "Unauthorized.",
                });
            }

            if (!ObjectId.isValid(req.user.id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid user ID.",
                });
            }

            const db = await connectDB();

            const usersCollection = db.collection("users");
            const paymentsCollection =
                db.collection("payments");

            const existingPayment =
                await paymentsCollection.findOne({
                    sessionId,
                });

            if (existingPayment) {
                return res.status(200).json({
                    success: true,
                    message:
                        "This payment has already been processed.",

                    payment: existingPayment,
                });
            }


            const session =
                await stripe.checkout.sessions.retrieve(
                    sessionId
                );



            if (session.payment_status !== "paid") {
                return res.status(400).json({
                    success: false,
                    message:
                        "Payment has not been completed.",
                });
            }


            if (
                session.metadata?.userId !==
                req.user.id
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "This payment does not belong to this user.",
                });
            }


            const credits = Number(
                session.metadata?.credits
            );

            const amount = Number(
                session.metadata?.amount
            );

            if (!credits || !amount) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid payment metadata.",
                });
            }


            const selectedPackage =
                CREDIT_PACKAGES[String(credits)];

            if (
                !selectedPackage ||
                selectedPackage.price !== amount
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid credit package.",
                });
            }

            const expectedAmount = amount * 100;

            if (
                Number(session.amount_total) !==
                expectedAmount
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Payment amount does not match the credit package.",
                });
            }


            const user = await usersCollection.findOne({
                _id: new ObjectId(req.user.id),
            });

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found.",
                });
            }

            if (user.role !== "supporter") {
                return res.status(403).json({
                    success: false,
                    message:
                        "Only supporters can purchase credits.",
                });
            }

            const paymentData = {
                user_id: user._id,

                user_email: user.email,

                user_name: user.name,

                credits,

                amount,

                payment_method: "Stripe",

                payment_status: "paid",

                sessionId: session.id,

                paymentIntentId:
                    session.payment_intent || null,

                transaction_id:
                    session.payment_intent || session.id,

                purchase_date: new Date(),

                createdAt: new Date(),
            };

            const paymentResult =
                await paymentsCollection.insertOne(
                    paymentData
                );


            const updateResult =
                await usersCollection.updateOne(
                    {
                        _id: user._id,

                        role: "supporter",
                    },

                    {
                        $inc: {
                            credits,
                        },
                    }
                );


            if (updateResult.modifiedCount !== 1) {
                await paymentsCollection.deleteOne({
                    _id: paymentResult.insertedId,
                });

                return res.status(500).json({
                    success: false,
                    message:
                        "Payment was successful, but credits could not be added.",
                });
            }


            const updatedUser =
                await usersCollection.findOne({
                    _id: user._id,
                });

            return res.status(201).json({
                success: true,

                message:
                    "Payment successful. Credits added successfully.",

                payment: {
                    _id: paymentResult.insertedId,

                    user_email: user.email,

                    user_name: user.name,

                    credits,

                    amount,

                    payment_method: "Stripe",

                    payment_status: "paid",

                    sessionId: session.id,

                    paymentIntentId:
                        session.payment_intent || null,

                    purchase_date:
                        paymentData.purchase_date,
                },

                credits: updatedUser.credits,
            });
        } catch (error) {
            console.error(
                "Confirm credit purchase error:",
                error
            );

            if (
                error.type ===
                "StripeInvalidRequestError"
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid Stripe checkout session.",
                });
            }

            return res.status(500).json({
                success: false,
                message:
                    "Failed to confirm credit purchase.",
            });
        }
    }
);


router.get(
    "/payment-history",
    verifyToken,
    async (req, res) => {
        try {
            if (!req.user?.id) {
                return res.status(401).json({
                    success: false,
                    message: "Unauthorized.",
                });
            }

            if (!ObjectId.isValid(req.user.id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid user ID.",
                });
            }

            const db = await connectDB();

            const usersCollection = db.collection("users");
            const paymentsCollection = db.collection("payments");

            const user = await usersCollection.findOne({
                _id: new ObjectId(req.user.id),
            });

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found.",
                });
            }

            if (user.role !== "supporter") {
                return res.status(403).json({
                    success: false,
                    message:
                        "Only supporters can view payment history.",
                });
            }

            const payments = await paymentsCollection
                .find({
                    user_id: user._id,
                })
                .sort({
                    purchase_date: -1,
                    createdAt: -1,
                })
                .toArray();

            return res.status(200).json({
                success: true,
                payments,
            });
        } catch (error) {
            console.error(
                "Payment history error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to load payment history.",
            });
        }
    }
);


module.exports = router;
