const express = require("express");
const { ObjectId } = require("mongodb");
const verifyToken = require("../middleware/verifyToken");

const dashboardRoutes = (
    usersCollection,
    campaignsCollection,
    contributionsCollection,
    paymentsCollection
) => {
    const router = express.Router();

    router.get(
        "/supporter-summary",
        verifyToken,
        async (req, res) => {
            try {
                if (req.user.role !== "supporter") {
                    return res.status(403).json({
                        message: "Access denied. Supporter only.",
                    });
                }

                const userId = req.user.id;

                if (!ObjectId.isValid(userId)) {
                    return res.status(400).json({
                        message: "Invalid user ID.",
                    });
                }

                const objectId = new ObjectId(userId);

                const user = await usersCollection.findOne({
                    _id: objectId,
                });

                if (!user) {
                    return res.status(404).json({
                        message: "User not found.",
                    });
                }

                const supporterContributions =
                    await contributionsCollection
                        .aggregate([
                            {
                                $match: {
                                    supporter_id: objectId,
                                },
                            },
                            {
                                $group: {
                                    _id: null,
                                    totalContributions: {
                                        $sum: 1,
                                    },
                                    pendingContributions: {
                                        $sum: {
                                            $cond: [
                                                {
                                                    $eq: [
                                                        "$status",
                                                        "pending",
                                                    ],
                                                },
                                                1,
                                                0,
                                            ],
                                        },
                                    },
                                    totalAmountContributed: {
                                        $sum: {
                                            $cond: [
                                                {
                                                    $eq: [
                                                        "$status",
                                                        "approved",
                                                    ],
                                                },
                                                "$contribution_amount",
                                                0,
                                            ],
                                        },
                                    },
                                },
                            },
                        ])
                        .toArray();

                const contributionSummary =
                    supporterContributions[0] || {
                        totalContributions: 0,
                        pendingContributions: 0,
                        totalAmountContributed: 0,
                    };

                return res.status(200).json({
                    success: true,
                    totalContributions:
                        contributionSummary.totalContributions || 0,
                    pendingContributions:
                        contributionSummary.pendingContributions || 0,
                    totalAmountContributed:
                        contributionSummary.totalAmountContributed || 0,
                    availableCredits: user.credits || 0,
                });
            } catch (error) {
                console.error(
                    "Supporter dashboard summary error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Failed to load supporter dashboard summary.",
                });
            }
        }
    );


    router.get(
        "/creator-dashboard-summary",
        verifyToken,
        async (req, res) => {
            try {
                if (req.user.role !== "creator") {
                    return res.status(403).json({
                        message: "Access denied. Creator only.",
                    });
                }

                const creatorId = req.user.id;

                const totalCampaigns =
                    await campaignsCollection.countDocuments({
                        creatorId: creatorId,
                    });

                const today = new Date()
                    .toISOString()
                    .split("T")[0];

                const activeCampaigns =
                    await campaignsCollection.countDocuments({
                        creatorId: creatorId,
                        status: "approved",
                        deadline: {
                            $gte: today,
                        },
                    });

                const creatorContributions =
                    await contributionsCollection
                        .aggregate([
                            {
                                $match: {
                                    status: {
                                        $in: [
                                            "completed",
                                            "approved",
                                        ],
                                    },
                                },
                            },
                            {
                                $lookup: {
                                    from: "campaigns",
                                    localField: "campaign_id",
                                    foreignField: "_id",
                                    as: "campaign",
                                },
                            },
                            {
                                $unwind: "$campaign",
                            },
                            {
                                $match: {
                                    "campaign.creatorId":
                                        creatorId,
                                },
                            },
                            {
                                $group: {
                                    _id: null,
                                    raisedCredits: {
                                        $sum: "$contribution_credit",
                                    },
                                },
                            },
                        ])
                        .toArray();

                const raisedCredits =
                    creatorContributions[0]?.raisedCredits || 0;

                const withdrawalAmount =
                    raisedCredits / 20;

                return res.status(200).json({
                    success: true,
                    totalCampaigns,
                    activeCampaigns,
                    raisedCredits,
                    withdrawalAmount,
                });
            } catch (error) {
                console.error(
                    "Creator dashboard summary error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Failed to load creator dashboard summary.",
                });
            }
        }
    );


    router.get(
        "/dashboard-summary",
        verifyToken,
        async (req, res) => {
            try {
                if (req.user.role !== "admin") {
                    return res.status(403).json({
                        message: "Access denied. Admin only.",
                    });
                }

                const [
                    totalUsers,
                    totalCampaigns,
                    totalContributions,
                    revenueResult,
                ] = await Promise.all([
                    usersCollection.countDocuments(),

                    campaignsCollection.countDocuments(),

                    contributionsCollection.countDocuments(),

                    paymentsCollection
                        .aggregate([
                            {
                                $match: {
                                    payment_status: "paid",
                                },
                            },
                            {
                                $group: {
                                    _id: null,
                                    totalRevenue: {
                                        $sum: "$amount",
                                    },
                                },
                            },
                        ])
                        .toArray(),
                ]);

                const totalRevenue =
                    revenueResult[0]?.totalRevenue || 0;

                return res.status(200).json({
                    success: true,
                    totalUsers,
                    totalCampaigns,
                    totalContributions,
                    totalRevenue,
                });
            } catch (error) {
                console.error(
                    "Admin dashboard summary error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Failed to load admin dashboard summary.",
                });
            }
        }
    );

    return router;
};

module.exports = dashboardRoutes;
