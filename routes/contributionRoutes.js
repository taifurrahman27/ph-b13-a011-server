const express = require("express");
const { ObjectId } = require("mongodb");
const connectDB = require("../utils/db");
const verifyToken = require("../middleware/verifyToken");

const router = express.Router();

const CONTRIBUTION_CREDITS_PER_DOLLAR = 10;
const WITHDRAWAL_CREDITS_PER_DOLLAR = 20;

const isValidObjectId = (id) => ObjectId.isValid(id);

const getCollections = async () => {
    const db = await connectDB();

    return {
        contributionsCollection: db.collection("contributions"),
        campaignsCollection: db.collection("campaigns"),
    };
};


router.get(
    "/my-contributions",
    verifyToken,
    async (req, res) => {
        try {
            if (!req.user?.id || !isValidObjectId(req.user.id)) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid user authentication.",
                });
            }

            const {
                contributionsCollection,
            } = await getCollections();

            const supporterId = String(req.user.id);

            console.log("Supporter ID:", supporterId);

            const supporterMatch = [
                {
                    supporter_id: supporterId,
                },
            ];

            if (isValidObjectId(req.user.id)) {
                supporterMatch.push({
                    supporter_id: new ObjectId(req.user.id),
                });
            }

            const contributions = await contributionsCollection
                .aggregate([
                    {
                        $match: {
                            $or: supporterMatch,
                        },
                    },

                    {
                        $addFields: {
                            campaignObjectId: {
                                $convert: {
                                    input: "$campaign_id",
                                    to: "objectId",
                                    onError: null,
                                    onNull: null,
                                },
                            },
                        },
                    },

                    {
                        $lookup: {
                            from: "campaigns",
                            localField: "campaignObjectId",
                            foreignField: "_id",
                            as: "campaign",
                        },
                    },

                    {
                        $unwind: {
                            path: "$campaign",
                            preserveNullAndEmptyArrays: true,
                        },
                    },

                    {
                        $sort: {
                            contribution_date: -1,
                        },
                    },

                    {
                        $project: {
                            _id: 1,
                            campaign_id: 1,
                            supporter_id: 1,
                            supporter_email: 1,
                            supporter_name: 1,
                            contribution_credit: 1,
                            contribution_amount: 1,
                            contribution_date: 1,
                            status: 1,

                            campaignTitle: {
                                $ifNull: [
                                    "$campaign.campaign_title",
                                    "Campaign Unavailable",
                                ],
                            },

                            campaignImage: {
                                $ifNull: [
                                    "$campaign.campaign_image_url",
                                    "",
                                ],
                            },

                            campaignStatus: "$campaign.status",
                            campaignCreatorId: "$campaign.creatorId",
                        },
                    },
                ])
                .toArray();

            console.log(
                "Supporter contributions:",
                contributions
            );

            return res.status(200).json({
                success: true,
                contributions,
            });
        } catch (error) {
            console.error(
                "Get supporter contributions error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Failed to fetch supporter contributions.",
            });
        }
    }
);



router.get("/supporter-summary", verifyToken, async (req, res) => {
    try {
        if (!req.user?.id || !isValidObjectId(req.user.id)) {
            return res.status(401).json({
                success: false,
                message: "Invalid user authentication.",
            });
        }
        const db = await connectDB();
        const userId = new ObjectId(req.user.id);
        const user = await db.collection("users").findOne(
            {
                _id: userId,
            },
            {
                projection: {
                    credits: 1,
                },
            }
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        const summary = await db
            .collection("contributions")
            .aggregate([
                {
                    $match: {
                        supporter_id: userId,
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
                                            {
                                                $toLower: {
                                                    $ifNull: [
                                                        "$status",
                                                        "",
                                                    ],
                                                },
                                            },
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
                                            {
                                                $toLower: {
                                                    $ifNull: [
                                                        "$status",
                                                        "",
                                                    ],
                                                },
                                            },
                                            "approved",
                                        ],
                                    },
                                    {
                                        $convert: {
                                            input: "$contribution_amount",
                                            to: "double",
                                            onError: 0,
                                            onNull: 0,
                                        },
                                    },
                                    0,
                                ],
                            },
                        },
                    },
                },
            ])
            .toArray();

        const data = summary[0] || {};

        return res.status(200).json({
            success: true,

            totalContributions: Number(
                data.totalContributions || 0
            ),

            pendingContributions: Number(
                data.pendingContributions || 0
            ),

            totalAmountContributed: Number(
                data.totalAmountContributed || 0
            ),

            availableCredits: Number(user.credits || 0),
        });
    } catch (error) {
        console.error("Supporter dashboard summary error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to load supporter dashboard summary.",
        });
    }
});

router.post("/", verifyToken, async (req, res) => {
    try {
        if (!req.user?.id || !isValidObjectId(req.user.id)) {
            return res.status(401).json({
                success: false,
                message: "Invalid user authentication.",
            });
        }

        const { campaignId, credits } = req.body;

        if (!campaignId) {
            return res.status(400).json({
                success: false,
                message: "Campaign ID is required.",
            });
        }

        if (!isValidObjectId(campaignId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid campaign ID.",
            });
        }


        const contributionCredits = Number(credits);

        if (
            !Number.isFinite(contributionCredits) ||
            contributionCredits <= 0 ||
            !Number.isInteger(contributionCredits)
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Contribution credits must be a positive whole number.",
            });
        }

        const db = await connectDB();

        const usersCollection = db.collection("users");
        const campaignsCollection = db.collection("campaigns");
        const contributionsCollection =
            db.collection("contributions");

        const userId = new ObjectId(req.user.id);
        const campaignObjectId = new ObjectId(campaignId);

        const user = await usersCollection.findOne({
            _id: userId,
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
                    "Only supporters can contribute to campaigns.",
            });
        }

        const campaign = await campaignsCollection.findOne({
            _id: campaignObjectId,
        });

        if (!campaign) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found.",
            });
        }

        if (
            campaign.status &&
            String(campaign.status).toLowerCase() !== "approved"
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "This campaign is not currently approved.",
            });
        }

        if (
            campaign.creator_id &&
            String(campaign.creator_id) === String(userId)
        ) {
            return res.status(403).json({
                success: false,
                message:
                    "You cannot contribute to your own campaign.",
            });
        }

        const minimumContribution = Number(
            campaign.minimum_Contribution || 0
        );

        if (
            minimumContribution > 0 &&
            contributionCredits < minimumContribution
        ) {
            return res.status(400).json({
                success: false,
                message: `Minimum contribution is ${minimumContribution} credits.`,
            });
        }

        const availableCredits = Number(user.credits || 0);

        if (availableCredits < contributionCredits) {
            return res.status(400).json({
                success: false,
                message: `Insufficient credits. You have ${availableCredits} credits available.`,
            });
        }

        const contributionAmount =
            contributionCredits;

        const contribution = {
            campaign_id: campaignObjectId,

            supporter_id: userId,
            supporter_email: user.email,
            supporter_name: user.name,

            contribution_credit: contributionCredits,
            contribution_amount: contributionAmount,

            contribution_date: new Date(),

            status: "pending",
        };

        const userUpdate = await usersCollection.updateOne(
            {
                _id: userId,
                credits: {
                    $gte: contributionCredits,
                },
            },
            {
                $inc: {
                    credits: -contributionCredits,
                },
            }
        );

        if (userUpdate.modifiedCount !== 1) {
            return res.status(400).json({
                success: false,
                message:
                    "Unable to deduct credits. Please try again.",
            });
        }

        try {
            const result =
                await contributionsCollection.insertOne(
                    contribution
                );

            contribution._id = result.insertedId;
        } catch (databaseError) {
            await usersCollection.updateOne(
                {
                    _id: userId,
                },
                {
                    $inc: {
                        credits: contributionCredits,
                    },
                }
            );

            throw databaseError;
        }

        const updatedUser = await usersCollection.findOne(
            {
                _id: userId,
            },
            {
                projection: {
                    credits: 1,
                },
            }
        );

        return res.status(201).json({
            success: true,

            message:
                "Contribution submitted successfully and is awaiting approval.",

            contribution: {
                _id: contribution._id,
                campaignId,
                credits: contributionCredits,
                amount: contributionAmount,
                status: "pending",
            },

            remainingCredits: Number(
                updatedUser?.credits || 0
            ),
        });
    } catch (error) {
        console.error("Contribution error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to process contribution.",
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
});


router.get("/my-contributions", verifyToken, async (req, res) => {
    try {
        const supporterId = req.user?.id;

        if (!supporterId || !ObjectId.isValid(supporterId)) {
            return res.status(401).json({
                success: false,
                message: "Invalid supporter authentication.",
            });
        }

        const contributions = await contributionsCollection
            .aggregate([
                {
                    $match: {
                        supporter_id: new ObjectId(supporterId),
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
                    $unwind: {
                        path: "$campaign",
                        preserveNullAndEmptyArrays: true,
                    },
                },
                {
                    $project: {
                        _id: 1,
                        campaign_id: 1,
                        supporter_id: 1,
                        supporter_email: 1,
                        supporter_name: 1,
                        contribution_credit: 1,
                        contribution_amount: 1,
                        contribution_date: 1,
                        status: 1,
                        approvedAt: 1,
                        campaignTitle: "$campaign.campaign_title",
                        campaignImage: "$campaign.campaign_image_url",
                    },
                },
                {
                    $sort: {
                        contribution_date: -1,
                    },
                },
            ])
            .toArray();

        return res.status(200).json({
            success: true,
            contributions,
        });
    } catch (error) {
        console.error("Get supporter contributions error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch contributions.",
        });
    }
});


router.patch("/:contributionId/approve", verifyToken, async (req, res) => {
    try {
        const { contributionId } = req.params;

        if (!isValidObjectId(contributionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid contribution ID.",
            });
        }

        if (!req.user?.id || !isValidObjectId(req.user.id)) {
            return res.status(401).json({
                success: false,
                message: "Invalid user authentication.",
            });
        }

        const db = await connectDB();

        const contribution = await db
            .collection("contributions")
            .findOne({
                _id: new ObjectId(contributionId),
            });

        if (!contribution) {
            return res.status(404).json({
                success: false,
                message: "Contribution not found.",
            });
        }

        if (
            String(contribution.status || "").toLowerCase() !==
            "pending"
        ) {
            return res.status(400).json({
                success: false,
                message: "Only pending contributions can be approved.",
            });
        }

        const campaign = await db
            .collection("campaigns")
            .findOne({
                _id: new ObjectId(contribution.campaign_id),
            });

        if (!campaign) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found.",
            });
        }

        if (
            String(campaign.creatorId) !==
            String(req.user.id)
        ) {
            return res.status(403).json({
                success: false,
                message:
                    "You are not authorized to approve this contribution.",
            });
        }

        const contributionResult = await db
            .collection("contributions")
            .updateOne(
                {
                    _id: new ObjectId(contributionId),
                    status: "pending",
                },
                {
                    $set: {
                        status: "approved",
                        approvedAt: new Date(),
                    },
                }
            );

        if (contributionResult.modifiedCount === 0) {
            return res.status(400).json({
                success: false,
                message: "Contribution could not be approved.",
            });
        }

        await db
            .collection("campaigns")
            .updateOne(
                {
                    _id: new ObjectId(contribution.campaign_id),
                },
                {
                    $inc: {
                        total_contributed: Number(
                            contribution.contribution_credit || 0
                        ),
                    },
                    $set: {
                        updatedAt: new Date(),
                    },
                }
            );

        return res.status(200).json({
            success: true,
            message: "Contribution approved successfully.",
        });
    } catch (error) {
        console.error(
            "Approve contribution error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to approve contribution.",
        });
    }
});



router.patch(
    "/:contributionId/reject",
    verifyToken,
    async (req, res) => {
        try {
            if (!req.user?.id || !isValidObjectId(req.user.id)) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid user authentication.",
                });
            }

            if (
                req.user.role &&
                String(req.user.role).toLowerCase() !== "creator"
            ) {
                return res.status(403).json({
                    success: false,
                    message: "Only creators can reject contributions.",
                });
            }

            const { contributionId } = req.params;

            if (!isValidObjectId(contributionId)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid contribution ID.",
                });
            }

            const db = await connectDB();

            const contributionsCollection =
                db.collection("contributions");

            const campaignsCollection =
                db.collection("campaigns");

            const usersCollection =
                db.collection("users");

            const contributionObjectId =
                new ObjectId(contributionId);

            const creatorObjectId =
                new ObjectId(req.user.id);

            const contribution =
                await contributionsCollection.findOne({
                    _id: contributionObjectId,
                });

            if (!contribution) {
                return res.status(404).json({
                    success: false,
                    message: "Contribution not found.",
                });
            }

            const contributionStatus =
                String(
                    contribution.status || ""
                ).toLowerCase();

            if (contributionStatus !== "pending") {
                return res.status(400).json({
                    success: false,
                    message:
                        "Only pending contributions can be rejected.",
                });
            }

            const contributionCredits = Number(
                contribution.contribution_credit
            );

            if (
                !Number.isFinite(contributionCredits) ||
                contributionCredits <= 0 ||
                !Number.isInteger(contributionCredits)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid contribution credit amount.",
                });
            }

            if (
                !contribution.supporter_id ||
                !ObjectId.isValid(contribution.supporter_id)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid supporter information.",
                });
            }

            const supporterObjectId =
                new ObjectId(contribution.supporter_id);


            const campaignId = contribution.campaign_id;

            if (!campaignId || !ObjectId.isValid(campaignId)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid campaign ID.",
                });
            }

            const campaign =
                await campaignsCollection.findOne({
                    _id: new ObjectId(campaignId),
                });

            if (!campaign) {
                return res.status(404).json({
                    success: false,
                    message: "Campaign not found.",
                });
            }

            const campaignCreatorId =
                campaign.creatorId ||
                campaign.creator_id;

            if (
                !campaignCreatorId ||
                String(campaignCreatorId) !==
                String(req.user.id)
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You are not authorized to reject this contribution.",
                });
            }

            const contributionUpdate =
                await contributionsCollection.updateOne(
                    {
                        _id: contributionObjectId,
                        status: "pending",
                    },
                    {
                        $set: {
                            status: "rejected",
                            rejected_at: new Date(),
                            rejected_by: creatorObjectId,
                        },
                    }
                );

            if (contributionUpdate.modifiedCount !== 1) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Contribution was already processed. Please refresh and try again.",
                });
            }

            try {
                const creditRestore =
                    await usersCollection.updateOne(
                        {
                            _id: supporterObjectId,
                            role: "supporter",
                        },
                        {
                            $inc: {
                                credits: contributionCredits,
                            },
                        }
                    );

                if (creditRestore.modifiedCount !== 1) {
                    throw new Error(
                        "Unable to restore supporter credits."
                    );
                }
            } catch (refundError) {
                await contributionsCollection.updateOne(
                    {
                        _id: contributionObjectId,
                        status: "rejected",
                    },
                    {
                        $set: {
                            status: "pending",
                        },
                        $unset: {
                            rejected_at: "",
                            rejected_by: "",
                        },
                    }
                );

                throw refundError;
            }

            const updatedSupporter =
                await usersCollection.findOne(
                    {
                        _id: supporterObjectId,
                    },
                    {
                        projection: {
                            credits: 1,
                        },
                    }
                );

            const supporterRemainingCredits =
                Number(
                    updatedSupporter?.credits || 0
                );

            return res.status(200).json({
                success: true,
                message:
                    "Contribution rejected and credits returned to the supporter.",

                contribution: {
                    _id: contributionObjectId,
                    status: "rejected",
                    credits: contributionCredits,
                    refundedCredits: contributionCredits,
                },

                supporter: {
                    _id: supporterObjectId,
                    credits: supporterRemainingCredits,
                },
            });
        } catch (error) {
            console.error(
                "Reject contribution error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to reject contribution.",

                error:
                    process.env.NODE_ENV === "development"
                        ? error.message
                        : undefined,
            });
        }
    }
);

router.get("/campaign/:campaignId", async (req, res) => {
    try {
        const { campaignId } = req.params;

        if (!isValidObjectId(campaignId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid campaign ID.",
            });
        }

        const db = await connectDB();

        const contributions =
            await db
                .collection("contributions")
                .aggregate([
                    {
                        $match: {
                            campaign_id:
                                new ObjectId(campaignId),
                        },
                    },
                    {
                        $lookup: {
                            from: "users",
                            localField: "supporter_id",
                            foreignField: "_id",
                            as: "supporter",
                        },
                    },
                    {
                        $unwind: {
                            path: "$supporter",
                            preserveNullAndEmptyArrays: true,
                        },
                    },
                    {
                        $sort: {
                            contribution_date: -1,
                        },
                    },
                    {
                        $project: {
                            _id: 1,

                            campaign_id: 1,

                            supporter_id: 1,
                            supporter_name: 1,
                            supporter_email: 1,

                            contribution_credit: 1,
                            contribution_amount: 1,

                            contribution_date: 1,
                            status: 1,

                            supporterImage:
                                "$supporter.profileImage",
                        },
                    },
                ])
                .toArray();

        return res.status(200).json({
            success: true,
            contributions,
        });
    } catch (error) {
        console.error(
            "Get campaign contributions error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Failed to load contributions.",
        });
    }
});

router.get("/creator/my-contributions", verifyToken, async (req, res) => {
    try {
        if (!req.user?.id || !isValidObjectId(req.user.id)) {
            return res.status(401).json({
                success: false,
                message: "Invalid user authentication.",
            });
        }
        const db = await connectDB();
        const creatorId = new ObjectId(req.user.id);
        const contributions =
            await db
                .collection("contributions")
                .aggregate([
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
                            "campaign.creator_id": creatorId,
                        },
                    },
                    {
                        $sort: {
                            contribution_date: -1,
                        },
                    },
                    {
                        $project: {
                            _id: 1,

                            campaign_id: 1,
                            campaignTitle:
                                "$campaign.title",

                            supporter_id: 1,
                            supporter_name: 1,
                            supporter_email: 1,

                            contribution_credit: 1,
                            contribution_amount: 1,

                            contribution_date: 1,
                            status: 1,
                        },
                    },
                ])
                .toArray();

        return res.status(200).json({
            success: true,
            contributions,
        });
    } catch (error) {
        console.error(
            "Get creator contributions error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Failed to load creator contributions.",
        });
    }
});

module.exports = router;
