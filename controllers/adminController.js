const { ObjectId } = require("mongodb");
const connectDB = require("../utils/db");

const getAllUsers = async (req, res) => {
    try {
        const db = await connectDB();

        const users = await db
            .collection("users")
            .find({})
            .project({
                password: 0,
            })
            .sort({ _id: -1 })
            .toArray();

        return res.status(200).json({
            success: true,
            users,
        });
    } catch (error) {
        console.error("Get all users error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch users.",
        });
    }
};

const getUserById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID.",
            });
        }

        const db = await connectDB();

        const user = await db.collection("users").findOne(
            {
                _id: new ObjectId(id),
            },
            {
                projection: {
                    password: 0,
                },
            }
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        return res.status(200).json({
            success: true,
            user,
        });
    } catch (error) {
        console.error("Get user by ID error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch user.",
        });
    }
};

module.exports = {
    getAllUsers,
    getUserById,
};
