const express = require("express");
const { ObjectId } = require("mongodb");
const connectDB = require("../utils/db");
const verifyToken = require("../middleware/verifyToken");

const router = express.Router();


router.get("/my-contributions", verifyToken, async (req, res) => {
    try {
        const db = await connectDB();

        const contributions = await db
            .collection("contributions")
            .aggregate([
                {
                    $match: {
                        supporter_id: new ObjectId(req.user.id),
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
                        campaignTitle: "$campaign.title",
                        campaignImage: "$campaign.coverImage",
                    },
                },
            ])
            .toArray();

        res.status(200).json({
            success: true,
            contributions,
        });
    } catch (error) {
        console.error("Get my contributions error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch contributions.",
        });
    }
});


router.post("/", verifyToken, async (req, res) => {
    try {
        const { campaignId, credits } = req.body;

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

        const contributionCredits = Number(credits);

        if (
            !Number.isFinite(contributionCredits) ||
            contributionCredits <= 0 ||
            !Number.isInteger(contributionCredits)
        ) {
            return res.status(400).json({
                message: "Contribution credits must be a positive whole number.",
            });
        }

        const db = await connectDB();

        const usersCollection = db.collection("users");
        const campaignsCollection = db.collection("campaigns");
        const contributionsCollection = db.collection("contributions");

        const userId = req.user.id;

        if (!userId || !ObjectId.isValid(userId)) {
            return res.status(401).json({
                message: "Invalid user authentication.",
            });
        }

        const user = await usersCollection.findOne({
            _id: new ObjectId(userId),
        });

        if (!user) {
            return res.status(404).json({
                message: "User not found.",
            });
        }

        if (user.role !== "supporter") {
            return res.status(403).json({
                message: "Only supporters can contribute to campaigns.",
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

        if (
            campaign.status &&
            campaign.status.toLowerCase() !== "approved"
        ) {
            return res.status(400).json({
                message: "This campaign is not currently approved.",
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
                message: `Minimum contribution is ${minimumContribution} credits.`,
            });
        }

        const availableCredits = Number(user.credits || 0);

        if (availableCredits < contributionCredits) {
            return res.status(400).json({
                message: `Insufficient credits. You have ${availableCredits} credits available.`,
            });
        }

        const newUserCredits =
            availableCredits - contributionCredits;

        const oldRaisedCredits = Number(
            campaign.total_contributed || 0
        );

        const newRaisedCredits =
            oldRaisedCredits + contributionCredits;

        const fundingGoal = Number(campaign.funding_goal || 0);

        const contributionAmount =
            contributionCredits / 10;

        const contribution = {
            campaign_id: new ObjectId(campaignId),
            supporter_id: new ObjectId(userId),
            supporter_email: user.email,
            supporter_name: user.name,
            contribution_credit: contributionCredits,
            contribution_amount: contributionAmount,
            contribution_date: new Date(),
            status: "completed",
        };

        const userUpdate = await usersCollection.updateOne(
            {
                _id: new ObjectId(userId),
                credits: { $gte: contributionCredits },
            },
            {
                $inc: {
                    credits: -contributionCredits,
                },
            }
        );

        if (userUpdate.modifiedCount !== 1) {
            return res.status(400).json({
                message: "Unable to deduct credits. Please try again.",
            });
        }

        try {
            await campaignsCollection.updateOne(
                {
                    _id: new ObjectId(campaignId),
                },
                {
                    $inc: {
                        total_contributed: contributionCredits,
                    },
                    $set: {
                        updatedAt: new Date(),
                    },
                }
            );

            await contributionsCollection.insertOne(contribution);
        } catch (databaseError) {
            await usersCollection.updateOne(
                {
                    _id: new ObjectId(userId),
                },
                {
                    $inc: {
                        credits: contributionCredits,
                    },
                }
            );

            throw databaseError;
        }

        const updatedCampaign = await campaignsCollection.findOne({
            _id: new ObjectId(campaignId),
        });

        const finalRaisedCredits = Number(
            updatedCampaign?.total_contributed || newRaisedCredits
        );

        const raisedAmount = finalRaisedCredits / 10;

        const progress =
            fundingGoal > 0
                ? Math.min(
                    (raisedAmount / fundingGoal) * 100,
                    100
                )
                : 0;

        return res.status(201).json({
            message: "Contribution submitted successfully.",
            contribution: {
                campaignId,
                credits: contributionCredits,
                amount: contributionAmount,
            },
            remainingCredits: newUserCredits,
            campaign: {
                raisedCredits: finalRaisedCredits,
                raisedAmount,
                progress,
            },
        });
    } catch (error) {
        console.error("Contribution error:", error);

        return res.status(500).json({
            message: "Failed to process contribution.",
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
});


router.get("/campaign/:campaignId", async (req, res) => {
    try {
        const { campaignId } = req.params;

        if (!ObjectId.isValid(campaignId)) {
            return res.status(400).json({
                message: "Invalid campaign ID.",
            });
        }

        const db = await connectDB();

        const contributionsCollection =
            db.collection("contributions");

        const contributions = await contributionsCollection
            .find({
                campaign_id: new ObjectId(campaignId),
            })
            .sort({
                contribution_date: -1,
            })
            .toArray();

        return res.status(200).json({
            contributions,
        });
    } catch (error) {
        console.error("Get contributions error:", error);

        return res.status(500).json({
            message: "Failed to load contributions.",
        });
    }
});

module.exports = router;
