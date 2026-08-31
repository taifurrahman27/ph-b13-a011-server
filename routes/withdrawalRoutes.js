const express = require("express");
const { ObjectId } = require("mongodb");
const verifyToken = require("../middleware/verifyToken");

const router = express.Router();

const CREATOR_CREDITS_PER_DOLLAR = 20;
const MINIMUM_WITHDRAWAL_CREDITS = 200;

module.exports = (
    withdrawalsCollection,
    usersCollection,
    contributionsCollection,
    campaignsCollection
) => {


    router.post("/", verifyToken, async (req, res) => {
        try {
            const creatorId = req.user?.id;
            const { amount } = req.body;

            if (!creatorId || !ObjectId.isValid(creatorId)) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid creator authentication.",
                });
            }

            const withdrawalCredits = Number(amount);

            if (
                amount === undefined ||
                amount === null ||
                amount === "" ||
                !Number.isFinite(withdrawalCredits)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Withdrawal amount must be a valid number.",
                });
            }

            if (!Number.isInteger(withdrawalCredits)) {
                return res.status(400).json({
                    success: false,
                    message: "Withdrawal credits must be a whole number.",
                });
            }

            if (withdrawalCredits < MINIMUM_WITHDRAWAL_CREDITS) {
                return res.status(400).json({
                    success: false,
                    message: "Minimum withdrawal is 200 credits ($10).",
                });
            }

            const creatorObjectId = new ObjectId(creatorId);

            const creator = await usersCollection.findOne({
                _id: creatorObjectId,
            });

            if (!creator) {
                return res.status(404).json({
                    success: false,
                    message: "Creator not found.",
                });
            }

            if (
                !creator.role ||
                String(creator.role).toLowerCase() !== "creator"
            ) {
                return res.status(403).json({
                    success: false,
                    message: "Only creators can request withdrawals.",
                });
            }

            const creatorCampaigns = await campaignsCollection
                .find({
                    creatorId: creatorId,
                })
                .project({
                    _id: 1,
                })
                .toArray();

            const campaignIds = creatorCampaigns.map(
                (campaign) => campaign._id
            );

            const approvedContributionResult =
                campaignIds.length > 0
                    ? await contributionsCollection
                        .aggregate([
                            {
                                $match: {
                                    campaign_id: {
                                        $in: campaignIds,
                                    },
                                    status: "approved",
                                },
                            },
                            {
                                $group: {
                                    _id: null,
                                    totalCredits: {
                                        $sum: {
                                            $convert: {
                                                input: "$contribution_credit",
                                                to: "double",
                                                onError: 0,
                                                onNull: 0,
                                            },
                                        },
                                    },
                                },
                            },
                        ])
                        .toArray()
                    : [];

            const totalRaisedCredits = Number(
                approvedContributionResult[0]?.totalCredits || 0
            );

            const previousWithdrawals =
                await withdrawalsCollection
                    .find({
                        creatorId: creatorId,
                        status: {
                            $in: ["pending", "approved"],
                        },
                    })
                    .toArray();

            const alreadyWithdrawnCredits =
                previousWithdrawals.reduce((total, withdrawal) => {
                    const credits = Number(withdrawal.amount || 0);

                    return (
                        total +
                        (Number.isFinite(credits) ? credits : 0)
                    );
                }, 0);

            const availableWithdrawalCredits =
                totalRaisedCredits - alreadyWithdrawnCredits;

            if (availableWithdrawalCredits < MINIMUM_WITHDRAWAL_CREDITS) {
                return res.status(400).json({
                    success: false,
                    message:
                        "You do not have enough available raised credits to request a withdrawal.",
                    totalRaisedCredits,
                    alreadyWithdrawnCredits,
                    availableWithdrawalCredits,
                });
            }

            if (withdrawalCredits > availableWithdrawalCredits) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Withdrawal credits cannot be greater than your available raised credits.",
                    totalRaisedCredits,
                    alreadyWithdrawnCredits,
                    availableWithdrawalCredits,
                });
            }

            const existingPending =
                await withdrawalsCollection.findOne({
                    creatorId: creatorId,
                    status: "pending",
                });

            if (existingPending) {
                return res.status(409).json({
                    success: false,
                    message:
                        "You already have a pending withdrawal request.",
                });
            }

            const now = new Date();

            const withdrawal = {
                creatorId: creatorId,
                amount: withdrawalCredits,
                withdrawalAmount:
                    withdrawalCredits / CREATOR_CREDITS_PER_DOLLAR,
                status: "pending",
                createdAt: now,
                updatedAt: now,
            };

            const result =
                await withdrawalsCollection.insertOne(withdrawal);

            return res.status(201).json({
                success: true,
                message:
                    "Withdrawal request submitted successfully.",
                withdrawal: {
                    _id: result.insertedId,
                    ...withdrawal,
                },
            });
        } catch (error) {
            console.error("Create withdrawal error:", error);

            return res.status(500).json({
                success: false,
                message:
                    error.message ||
                    "Failed to create withdrawal request.",
            });
        }
    });

    router.get("/creator/:creatorId", async (req, res) => {
        try {
            const { creatorId } = req.params;

            if (!ObjectId.isValid(creatorId)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid creator ID.",
                });
            }

            const withdrawals =
                await withdrawalsCollection
                    .find({
                        creatorId: creatorId,
                    })
                    .sort({
                        createdAt: -1,
                    })
                    .toArray();

            return res.status(200).json({
                success: true,
                withdrawals,
            });
        } catch (error) {
            console.error(
                "Get creator withdrawals error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Failed to fetch withdrawals.",
            });
        }
    });

    router.get("/", async (req, res) => {
        try {
            const withdrawals =
                await withdrawalsCollection
                    .aggregate([
                        {
                            $addFields: {
                                creatorObjectId: {
                                    $convert: {
                                        input: "$creatorId",
                                        to: "objectId",
                                        onError: null,
                                        onNull: null,
                                    },
                                },
                            },
                        },
                        {
                            $lookup: {
                                from: "users",
                                localField: "creatorObjectId",
                                foreignField: "_id",
                                as: "creator",
                            },
                        },
                        {
                            $unwind: {
                                path: "$creator",
                                preserveNullAndEmptyArrays: true,
                            },
                        },
                        {
                            $project: {
                                creatorObjectId: 0,
                                "creator.password": 0,
                            },
                        },
                        {
                            $sort: {
                                createdAt: -1,
                            },
                        },
                    ])
                    .toArray();

            return res.status(200).json({
                success: true,
                withdrawals,
            });
        } catch (error) {
            console.error(
                "Get all withdrawals error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to fetch withdrawal requests.",
            });
        }
    });

    router.get("/:id", async (req, res) => {
        try {
            const { id } = req.params;

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid withdrawal ID.",
                });
            }

            const withdrawal =
                await withdrawalsCollection.findOne({
                    _id: new ObjectId(id),
                });

            if (!withdrawal) {
                return res.status(404).json({
                    success: false,
                    message: "Withdrawal not found.",
                });
            }

            return res.status(200).json({
                success: true,
                withdrawal,
            });
        } catch (error) {
            console.error(
                "Get withdrawal error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Failed to fetch withdrawal.",
            });
        }
    });


    router.patch("/:id/approve", async (req, res) => {
        try {
            const { id } = req.params;

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid withdrawal ID.",
                });
            }

            const withdrawal =
                await withdrawalsCollection.findOne({
                    _id: new ObjectId(id),
                });

            if (!withdrawal) {
                return res.status(404).json({
                    success: false,
                    message: "Withdrawal not found.",
                });
            }

            if (withdrawal.status !== "pending") {
                return res.status(400).json({
                    success: false,
                    message:
                        "Only pending withdrawals can be approved.",
                });
            }

            const now = new Date();

            const withdrawalUpdate =
                await withdrawalsCollection.updateOne(
                    {
                        _id: new ObjectId(id),
                        status: "pending",
                    },
                    {
                        $set: {
                            status: "approved",
                            updatedAt: now,
                        },
                    }
                );

            if (withdrawalUpdate.modifiedCount !== 1) {
                return res.status(500).json({
                    success: false,
                    message:
                        "Failed to approve withdrawal.",
                });
            }

            return res.status(200).json({
                success: true,
                message:
                    "Withdrawal approved successfully.",
            });
        } catch (error) {
            console.error(
                "Approve withdrawal error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to approve withdrawal.",
            });
        }
    });


    router.patch("/:id/reject", async (req, res) => {
        try {
            const { id } = req.params;

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid withdrawal ID.",
                });
            }

            const withdrawal =
                await withdrawalsCollection.findOne({
                    _id: new ObjectId(id),
                });

            if (!withdrawal) {
                return res.status(404).json({
                    success: false,
                    message: "Withdrawal not found.",
                });
            }

            if (withdrawal.status !== "pending") {
                return res.status(400).json({
                    success: false,
                    message:
                        "Only pending withdrawals can be rejected.",
                });
            }

            const now = new Date();

            const result =
                await withdrawalsCollection.updateOne(
                    {
                        _id: new ObjectId(id),
                        status: "pending",
                    },
                    {
                        $set: {
                            status: "rejected",
                            updatedAt: now,
                        },
                    }
                );

            if (result.modifiedCount !== 1) {
                return res.status(500).json({
                    success: false,
                    message:
                        "Failed to reject withdrawal.",
                });
            }

            return res.status(200).json({
                success: true,
                message:
                    "Withdrawal rejected successfully.",
            });
        } catch (error) {
            console.error(
                "Reject withdrawal error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to reject withdrawal.",
            });
        }
    });

    return router;
};
