const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const connectDB = require("../utils/db");
const verifyToken = require("../middleware/verifyToken");
const { ObjectId } = require("mongodb");
const { OAuth2Client } = require("google-auth-library");

const router = express.Router();

const googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID
);

const createToken = (user) => {
    return jwt.sign(
        {
            id: user._id.toString(),
            email: user.email,
            role: user.role,
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "7d",
        }
    );
};

const formatUser = (user) => ({
    id: user._id,
    name: user.name,
    email: user.email,
    profileImage: user.profileImage,
    role: user.role,
    credits: user.credits,
});

router.post("/register", async (req, res) => {
    try {
        const {
            name,
            email,
            profileImage,
            password,
            role,
        } = req.body;

        if (!name || !email || !profileImage || !password || !role) {
            return res.status(400).json({
                message: "All fields are required.",
            });
        }

        const trimmedName = name.trim();
        const normalizedEmail = email.trim().toLowerCase();
        const trimmedProfileImage = profileImage.trim();

        if (!trimmedName) {
            return res.status(400).json({
                message: "Name is required.",
            });
        }

        if (!["supporter", "creator"].includes(role)) {
            return res.status(400).json({
                message: "Invalid role.",
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({
                message: "Please provide a valid email address.",
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                message: "Password must be at least 8 characters long.",
            });
        }

        if (!process.env.JWT_SECRET) {
            console.error(
                "JWT_SECRET is missing from environment variables."
            );

            return res.status(500).json({
                message: "Server authentication configuration is missing.",
            });
        }

        const db = await connectDB();
        const usersCollection = db.collection("users");

        const existingUser = await usersCollection.findOne({
            email: normalizedEmail,
        });

        if (existingUser) {
            return res.status(409).json({
                message: "An account with this email already exists.",
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const credits = role === "supporter" ? 50 : 20;

        const newUser = {
            name: trimmedName,
            email: normalizedEmail,
            profileImage: trimmedProfileImage,
            password: hashedPassword,
            role,
            credits,
            createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);

        const createdUser = {
            ...newUser,
            _id: result.insertedId,
        };

        const token = createToken(createdUser);

        return res.status(201).json({
            message: "Registration successful.",
            token,
            user: formatUser(createdUser),
        });
    } catch (error) {
        console.error("Registration error:", error);

        return res.status(500).json({
            message: "Something went wrong during registration.",
        });
    }
});

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required.",
            });
        }

        if (!process.env.JWT_SECRET) {
            console.error(
                "JWT_SECRET is missing from environment variables."
            );

            return res.status(500).json({
                message: "Server authentication configuration is missing.",
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const db = await connectDB();
        const usersCollection = db.collection("users");

        const user = await usersCollection.findOne({
            email: normalizedEmail,
        });

        if (!user) {
            return res.status(401).json({
                message: "Invalid email or password.",
            });
        }

        const isPasswordValid = await bcrypt.compare(
            password,
            user.password
        );

        if (!isPasswordValid) {
            return res.status(401).json({
                message: "Invalid email or password.",
            });
        }

        const token = createToken(user);

        return res.status(200).json({
            message: "Login successful.",
            token,
            user: formatUser(user),
        });
    } catch (error) {
        console.error("Login error:", error);

        return res.status(500).json({
            message: "Something went wrong during login.",
        });
    }
});


router.post("/google", async (req, res) => {
    try {
        const { credential, role } = req.body;

        if (!credential) {
            return res.status(400).json({
                message: "Google credential is required.",
            });
        }

        if (!process.env.GOOGLE_CLIENT_ID) {
            console.error(
                "GOOGLE_CLIENT_ID is missing from environment variables."
            );

            return res.status(500).json({
                message: "Google authentication is not configured.",
            });
        }

        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();

        if (!payload) {
            return res.status(401).json({
                message: "Invalid Google account.",
            });
        }

        const {
            sub: googleId,
            email,
            name,
            picture,
            email_verified,
        } = payload;

        if (!email || !email_verified) {
            return res.status(401).json({
                message: "Google email could not be verified.",
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const db = await connectDB();
        const usersCollection = db.collection("users");

        let user = await usersCollection.findOne({
            email: normalizedEmail,
        });

    
        if (user) {
            const token = createToken(user);

            return res.status(200).json({
                message: "Google login successful.",
                token,
                user: formatUser(user),
            });
        }

        if (!role) {
            return res.status(200).json({
                requiresRole: true,
                googleUser: {
                    googleId,
                    name: name || "Google User",
                    email: normalizedEmail,
                    profileImage: picture || "",
                },
            });
        }

        if (!["supporter", "creator"].includes(role)) {
            return res.status(400).json({
                message: "Invalid role.",
            });
        }

        const credits = role === "supporter" ? 50 : 20;

        const newUser = {
            name: (name || "Google User").trim(),
            email: normalizedEmail,
            profileImage: picture || "",
            password: null,
            googleId,
            role,
            credits,
            createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);

        user = {
            ...newUser,
            _id: result.insertedId,
        };

        const token = createToken(user);

        return res.status(201).json({
            message: "Google account created successfully.",
            token,
            user: formatUser(user),
        });
    } catch (error) {
        console.error("Google login error:", error);

        return res.status(401).json({
            message: "Google authentication failed.",
        });
    }
});


router.get("/me", verifyToken, async (req, res) => {
    try {
        if (!req.user?.id || !ObjectId.isValid(req.user.id)) {
            return res.status(401).json({
                message: "Invalid user token.",
            });
        }

        const db = await connectDB();
        const usersCollection = db.collection("users");

        const user = await usersCollection.findOne({
            _id: new ObjectId(req.user.id),
        });

        if (!user) {
            return res.status(404).json({
                message: "User not found.",
            });
        }

        return res.status(200).json({
            user: formatUser(user),
        });
    } catch (error) {
        console.error("Get current user error:", error);

        return res.status(500).json({
            message: "Failed to get current user.",
        });
    }
});

module.exports = router;
