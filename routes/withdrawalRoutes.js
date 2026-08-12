const express = require("express");
const { ObjectId } = require("mongodb");

const router = express.Router();

module.exports = (withdrawalsCollection, usersCollection) => {
    /*
    ==========================================
    CREATE WITHDRAWAL REQUEST
    POST /api/withdrawals
    ==========================================
    */

    router.post("/", async (req, res) => {
        try {
            const {
                creatorId,
                amount,
            } = req.body;

            if (!creatorId) {
                return res.status(400).json({
                    message: "Creator ID is required.",
                });
            }

            if (!ObjectId.isValid(creatorId)) {
                return res.status(400).json({
                    message: "Invalid creator ID.",
                });
            }

            if (
                amount === undefined ||
                amount === null ||
                amount === ""
            ) {
                return res.status(400).json({
                    message: "Withdrawal amount is required.",
                });
            }

            const withdrawalAmount = Number(amount);

            if (!Number.isFinite(withdrawalAmount)) {
                return res.status(400).json({
                    message: "Withdrawal amount must be a valid number.",
                });
            }

            if (withdrawalAmount <= 0) {
                return res.status(400).json({
                    message:
                        "Withdrawal amount must be greater than 0.",
                });
            }

            /*
            ==========================================
            CHECK CREATOR
            ==========================================
            */

            const creator = await usersCollection.findOne({
                _id: new ObjectId(creatorId),
            });

            if (!creator) {
                return res.status(404).json({
                    message: "Creator not found.",
                });
            }

            if (
                !creator.role ||
                creator.role.toLowerCase() !== "creator"
            ) {
                return res.status(403).json({
                    message:
                        "Only creators can request withdrawals.",
                });
            }

            /*
            ==========================================
            CHECK AVAILABLE CREDITS
            ==========================================
            */

            const availableCredits = Number(
                creator.credits || 0
            );

            if (withdrawalAmount > availableCredits) {
                return res.status(400).json({
                    message:
                        "Withdrawal amount cannot be greater than your available credits.",
                    availableCredits,
                });
            }

            /*
            ==========================================
            PREVENT MULTIPLE PENDING REQUESTS
            ==========================================
            */

            const existingPending =
                await withdrawalsCollection.findOne({
                    creatorId,
                    status: "pending",
                });

            if (existingPending) {
                return res.status(409).json({
                    message:
                        "You already have a pending withdrawal request.",
                });
            }

            /*
            ==========================================
            CREATE WITHDRAWAL
            ==========================================
            */

            const now = new Date();

            const withdrawal = {
                creatorId,

                amount: withdrawalAmount,

                status: "pending",

                createdAt: now,
                updatedAt: now,
            };

            const result =
                await withdrawalsCollection.insertOne(
                    withdrawal
                );

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
            console.error(
                "Create withdrawal error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to create withdrawal request.",
            });
        }
    });

    /*
    ==========================================
    GET CREATOR WITHDRAWALS
    GET /api/withdrawals/creator/:creatorId
    ==========================================
    */

    router.get(
        "/creator/:creatorId",
        async (req, res) => {
            try {
                const { creatorId } = req.params;

                if (!ObjectId.isValid(creatorId)) {
                    return res.status(400).json({
                        message: "Invalid creator ID.",
                    });
                }

                const withdrawals =
                    await withdrawalsCollection
                        .find({
                            creatorId,
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
                    message:
                        "Failed to fetch withdrawals.",
                });
            }
        }
    );

    /*
    ==========================================
    GET ALL WITHDRAWALS
    GET /api/withdrawals
    ADMIN
    ==========================================
    */

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
                                localField:
                                    "creatorObjectId",
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
                    ])
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
                "Get all withdrawals error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to fetch withdrawal requests.",
            });
        }
    });

    /*
    ==========================================
    GET SINGLE WITHDRAWAL
    GET /api/withdrawals/:id
    ==========================================
    */

    router.get("/:id", async (req, res) => {
        try {
            const { id } = req.params;

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({
                    message: "Invalid withdrawal ID.",
                });
            }

            const withdrawal =
                await withdrawalsCollection.findOne({
                    _id: new ObjectId(id),
                });

            if (!withdrawal) {
                return res.status(404).json({
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
                message:
                    "Failed to fetch withdrawal.",
            });
        }
    });

    /*
    ==========================================
    APPROVE WITHDRAWAL
    PATCH /api/withdrawals/:id/approve
    ADMIN
    ==========================================
    */

    router.patch(
        "/:id/approve",
        async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({
                        message:
                            "Invalid withdrawal ID.",
                    });
                }

                const withdrawal =
                    await withdrawalsCollection.findOne({
                        _id: new ObjectId(id),
                    });

                if (!withdrawal) {
                    return res.status(404).json({
                        message:
                            "Withdrawal not found.",
                    });
                }

                if (
                    withdrawal.status !==
                    "pending"
                ) {
                    return res.status(400).json({
                        message:
                            "Only pending withdrawals can be approved.",
                    });
                }

                const creator =
                    await usersCollection.findOne({
                        _id: new ObjectId(
                            withdrawal.creatorId
                        ),
                    });

                if (!creator) {
                    return res.status(404).json({
                        message:
                            "Creator not found.",
                    });
                }

                const availableCredits =
                    Number(creator.credits || 0);

                if (
                    Number(withdrawal.amount) >
                    availableCredits
                ) {
                    return res.status(400).json({
                        message:
                            "Creator does not have enough credits to complete this withdrawal.",
                        availableCredits,
                    });
                }

                const now = new Date();

                /*
                Deduct credits only when Admin approves.
                */

                const userUpdate =
                    await usersCollection.updateOne(
                        {
                            _id: new ObjectId(
                                withdrawal.creatorId
                            ),
                            credits: {
                                $gte: Number(
                                    withdrawal.amount
                                ),
                            },
                        },
                        {
                            $inc: {
                                credits:
                                    -Number(
                                        withdrawal.amount
                                    ),
                            },
                            $set: {
                                updatedAt: now,
                            },
                        }
                    );

                if (
                    userUpdate.modifiedCount !== 1
                ) {
                    return res.status(400).json({
                        message:
                            "Failed to deduct creator credits.",
                    });
                }

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

                if (
                    withdrawalUpdate.modifiedCount !==
                    1
                ) {
                    /*
                    Rollback credits if withdrawal
                    status could not be updated.
                    */

                    await usersCollection.updateOne(
                        {
                            _id: new ObjectId(
                                withdrawal.creatorId
                            ),
                        },
                        {
                            $inc: {
                                credits:
                                    Number(
                                        withdrawal.amount
                                    ),
                            },
                        }
                    );

                    return res.status(500).json({
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
                    message:
                        "Failed to approve withdrawal.",
                });
            }
        }
    );

    /*
    ==========================================
    REJECT WITHDRAWAL
    PATCH /api/withdrawals/:id/reject
    ADMIN
    ==========================================
    */

    router.patch(
        "/:id/reject",
        async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({
                        message:
                            "Invalid withdrawal ID.",
                    });
                }

                const withdrawal =
                    await withdrawalsCollection.findOne({
                        _id: new ObjectId(id),
                    });

                if (!withdrawal) {
                    return res.status(404).json({
                        message:
                            "Withdrawal not found.",
                    });
                }

                if (
                    withdrawal.status !==
                    "pending"
                ) {
                    return res.status(400).json({
                        message:
                            "Only pending withdrawals can be rejected.",
                    });
                }

                const now = new Date();

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
                    message:
                        "Failed to reject withdrawal.",
                });
            }
        }
    );

    return router;
};