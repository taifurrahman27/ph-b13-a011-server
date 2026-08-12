const express = require("express");
const { ObjectId } = require("mongodb");

const router = express.Router();

module.exports = (campaignsCollection, usersCollection) => {
    // ==========================================
    // CREATE CAMPAIGN
    // POST /api/campaigns
    // ==========================================
    router.post("/", async (req, res) => {
        try {
            const {
                creatorId,
                campaign_title,
                campaign_story,
                category,
                funding_goal,
                minimum_Contribution,
                deadline,
                reward_info,
                campaign_image_url,
            } = req.body;

            // ------------------------------------------
            // Validate creator ID
            // ------------------------------------------
            if (!creatorId) {
                return res.status(400).json({
                    success: false,
                    message: "Creator ID is required.",
                });
            }

            if (!ObjectId.isValid(creatorId)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid creator ID.",
                });
            }

            // ------------------------------------------
            // Validate required fields
            // ------------------------------------------
            if (
                !campaign_title ||
                !campaign_story ||
                !category ||
                funding_goal === undefined ||
                funding_goal === null ||
                minimum_Contribution === undefined ||
                minimum_Contribution === null ||
                !deadline ||
                !reward_info ||
                !campaign_image_url
            ) {
                return res.status(400).json({
                    success: false,
                    message: "All campaign fields are required.",
                });
            }

            // ------------------------------------------
            // Verify creator exists
            // ------------------------------------------
            const creator = await usersCollection.findOne({
                _id: new ObjectId(creatorId),
            });

            if (!creator) {
                return res.status(404).json({
                    success: false,
                    message: "Creator not found.",
                });
            }

            // ------------------------------------------
            // Verify creator role
            // ------------------------------------------
            if (
                creator.role?.toLowerCase() !== "creator"
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "Only creators can create campaigns.",
                });
            }

            // ------------------------------------------
            // Clean string values
            // ------------------------------------------
            const cleanTitle = String(
                campaign_title
            ).trim();

            const cleanStory = String(
                campaign_story
            ).trim();

            const cleanCategory = String(
                category
            ).trim();

            const cleanRewardInfo = String(
                reward_info
            ).trim();

            const cleanImageUrl = String(
                campaign_image_url
            ).trim();

            // ------------------------------------------
            // Check empty strings
            // ------------------------------------------
            if (
                !cleanTitle ||
                !cleanStory ||
                !cleanCategory ||
                !cleanRewardInfo ||
                !cleanImageUrl
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Campaign fields cannot be empty.",
                });
            }

            // ------------------------------------------
            // Validate funding values
            // ------------------------------------------
            const fundingGoal = Number(
                funding_goal
            );

            const minimumContribution = Number(
                minimum_Contribution
            );

            if (
                !Number.isFinite(fundingGoal) ||
                !Number.isFinite(minimumContribution)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Funding goal and minimum contribution must be valid numbers.",
                });
            }

            if (
                fundingGoal <= 0 ||
                minimumContribution <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Funding goal and minimum contribution must be greater than 0.",
                });
            }

            if (
                minimumContribution > fundingGoal
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Minimum contribution cannot be greater than the funding goal.",
                });
            }

            // ------------------------------------------
            // Validate deadline
            // ------------------------------------------
            const deadlineDate = new Date(
                `${deadline}T23:59:59`
            );

            if (
                Number.isNaN(
                    deadlineDate.getTime()
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid campaign deadline.",
                });
            }

            const today = new Date();

            today.setHours(0, 0, 0, 0);

            if (deadlineDate < today) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Campaign deadline cannot be in the past.",
                });
            }

            // ------------------------------------------
            // Validate image URL
            // ------------------------------------------
            try {
                const imageUrl = new URL(
                    cleanImageUrl
                );

                if (
                    imageUrl.protocol !== "http:" &&
                    imageUrl.protocol !== "https:"
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Campaign image URL must use HTTP or HTTPS.",
                    });
                }
            } catch {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid campaign image URL.",
                });
            }

            // ------------------------------------------
            // Create campaign
            // ------------------------------------------
            const now = new Date();

            const campaign = {
                creatorId,

                campaign_title: cleanTitle,
                campaign_story: cleanStory,
                category: cleanCategory,

                funding_goal: fundingGoal,
                minimum_Contribution:
                    minimumContribution,

                deadline,

                reward_info: cleanRewardInfo,
                campaign_image_url: cleanImageUrl,

                status: "pending",

                total_contributed: 0,

                createdAt: now,
                updatedAt: now,
            };

            const result =
                await campaignsCollection.insertOne(
                    campaign
                );

            return res.status(201).json({
                success: true,
                message:
                    "Campaign created successfully.",

                campaign: {
                    _id: result.insertedId,
                    ...campaign,
                },
            });
        } catch (error) {
            console.error(
                "Create campaign error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to create campaign.",
            });
        }
    });

    // ==========================================
    // GET MY CAMPAIGNS
    // GET /api/campaigns/my-campaigns
    // ==========================================
    router.get(
        "/my-campaigns",
        async (req, res) => {
            try {
                const creatorId =
                    req.headers["x-user-id"];

                if (!creatorId) {
                    return res.status(401).json({
                        success: false,
                        message:
                            "Creator ID is required.",
                    });
                }

                if (!ObjectId.isValid(creatorId)) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Invalid creator ID.",
                    });
                }

                const creator =
                    await usersCollection.findOne({
                        _id: new ObjectId(
                            creatorId
                        ),
                    });

                if (!creator) {
                    return res.status(404).json({
                        success: false,
                        message:
                            "Creator not found.",
                    });
                }

                if (
                    creator.role?.toLowerCase() !==
                    "creator"
                ) {
                    return res.status(403).json({
                        success: false,
                        message:
                            "Only creators can access their campaigns.",
                    });
                }

                const campaigns =
                    await campaignsCollection
                        .find({
                            creatorId,
                        })
                        .sort({
                            createdAt: -1,
                        })
                        .toArray();

                return res.status(200).json({
                    success: true,
                    campaigns,
                });
            } catch (error) {
                console.error(
                    "Get my campaigns error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Failed to fetch your campaigns.",
                });
            }
        }
    );

    // ==========================================
    // GET APPROVED CAMPAIGNS
    // GET /api/campaigns
    // ==========================================
    router.get("/", async (req, res) => {
        try {
            const campaigns =
                await campaignsCollection
                    .find({
                        status: "approved",
                    })
                    .sort({
                        createdAt: -1,
                    })
                    .toArray();

            return res.status(200).json({
                success: true,
                campaigns,
            });
        } catch (error) {
            console.error(
                "Get campaigns error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to fetch campaigns.",
            });
        }
    });

    // ==========================================
    // GET SINGLE CAMPAIGN
    // GET /api/campaigns/:id
    // ==========================================
    router.get("/:id", async (req, res) => {
        try {
            const { id } = req.params;

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid campaign ID.",
                });
            }

            const campaign =
                await campaignsCollection.findOne({
                    _id: new ObjectId(id),
                });

            if (!campaign) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Campaign not found.",
                });
            }

            return res.status(200).json({
                success: true,
                campaign,
            });
        } catch (error) {
            console.error(
                "Get campaign error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to fetch campaign.",
            });
        }
    });

    return router;
};