const express = require("express");
const { ObjectId } = require("mongodb");
const Stripe = require("stripe");

const router = express.Router();

module.exports = (campaignsCollection, contributionsCollection) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const verifyToken = require("../middleware/verifyToken");

    router.post(
        "/create-checkout-session",
        verifyToken,
        async (req, res) => {
            try {
                const { campaignId, amount } = req.body;

                const supporterId = req.user.id;

                if (!supporterId) {
                    return res.status(401).json({
                        message: "Invalid user token.",
                    });
                }

                if (!ObjectId.isValid(supporterId)) {
                    return res.status(400).json({
                        message: "Invalid user ID.",
                    });
                }


                if (!campaignId) {
                    return res.status(400).json({
                        message: "Campaign ID is required.",
                    });
                }

                if (!ObjectId.isValid(campaignId)) {
                    return res.status(400).json({
                        message: "Invalid campaign ID.",
                    });
                }


                if (
                    amount === undefined ||
                    amount === null ||
                    amount === ""
                ) {
                    return res.status(400).json({
                        message: "Contribution amount is required.",
                    });
                }

                const contributionAmount = Number(amount);

                if (
                    !Number.isFinite(contributionAmount) ||
                    contributionAmount <= 0
                ) {
                    return res.status(400).json({
                        message:
                            "Contribution amount must be a valid positive number.",
                    });
                }


                const campaign = await campaignsCollection.findOne({
                    _id: new ObjectId(campaignId),
                });

                if (!campaign) {
                    return res.status(404).json({
                        message: "Campaign not found.",
                    });
                }

                if (campaign.status !== "approved") {
                    return res.status(400).json({
                        message:
                            "This campaign is not currently accepting contributions.",
                    });
                }

                const minimumContribution = Number(
                    campaign.minimum_Contribution
                );

                if (
                    !Number.isFinite(minimumContribution) ||
                    minimumContribution <= 0
                ) {
                    return res.status(400).json({
                        message:
                            "Campaign minimum contribution is invalid.",
                    });
                }

                if (contributionAmount < minimumContribution) {
                    return res.status(400).json({
                        message: `Minimum contribution is $${minimumContribution}.`,
                    });
                }

                const deadline = new Date(campaign.deadline);

                if (Number.isNaN(deadline.getTime())) {
                    return res.status(400).json({
                        message: "Campaign deadline is invalid.",
                    });
                }

                if (deadline < new Date()) {
                    return res.status(400).json({
                        message: "This campaign has already ended.",
                    });
                }

                const fundingGoal = Number(campaign.funding_goal);
                const totalContributed = Number(
                    campaign.total_contributed || 0
                );

                if (
                    !Number.isFinite(fundingGoal) ||
                    fundingGoal <= 0
                ) {
                    return res.status(400).json({
                        message: "Campaign funding goal is invalid.",
                    });
                }

                const remainingAmount =
                    fundingGoal - totalContributed;

                if (remainingAmount <= 0) {
                    return res.status(400).json({
                        message:
                            "This campaign has already reached its funding goal.",
                    });
                }

                if (contributionAmount > remainingAmount) {
                    return res.status(400).json({
                        message: `Maximum contribution allowed is $${remainingAmount}.`,
                    });
                }

                const amountInCents = Math.round(
                    contributionAmount * 100
                );

                const now = new Date();

                const contribution = {
                    campaignId,
                    creatorId: campaign.creatorId,
                    supporterId,

                    amount: contributionAmount,
                    currency: "usd",

                    status: "pending",
                    paymentStatus: "pending",

                    stripeSessionId: null,
                    stripePaymentIntentId: null,

                    createdAt: now,
                    updatedAt: now,
                };

                const contributionResult =
                    await contributionsCollection.insertOne(
                        contribution
                    );

                const frontendUrl =
                    process.env.BETTER_AUTH_URL ||
                    "http://localhost:3000";

                const session =
                    await stripe.checkout.sessions.create({
                        mode: "payment",

                        payment_method_types: ["card"],

                        line_items: [
                            {
                                price_data: {
                                    currency: "usd",

                                    product_data: {
                                        name:
                                            campaign.campaign_title,

                                        description:
                                            `Contribution to ${campaign.campaign_title}`,
                                    },

                                    unit_amount: amountInCents,
                                },

                                quantity: 1,
                            },
                        ],

                        metadata: {
                            contributionId:
                                contributionResult.insertedId.toString(),

                            campaignId,

                            supporterId,

                            creatorId: campaign.creatorId,
                        },

                        success_url:
                            `${frontendUrl}/dashboard/my-contributions?payment=success&session_id={CHECKOUT_SESSION_ID}`,

                        cancel_url:
                            `${frontendUrl}/dashboard/explore-campaigns?payment=cancelled`,
                    });

                await contributionsCollection.updateOne(
                    {
                        _id: contributionResult.insertedId,
                    },
                    {
                        $set: {
                            stripeSessionId: session.id,
                            updatedAt: new Date(),
                        },
                    }
                );

                return res.status(200).json({
                    success: true,
                    message:
                        "Checkout session created successfully.",
                    url: session.url,
                    sessionId: session.id,
                });
            } catch (error) {
                console.error(
                    "Create checkout session error:",
                    error
                );

                return res.status(500).json({
                    message:
                        "Failed to create checkout session.",
                });
            }
        });

    return router;
};
