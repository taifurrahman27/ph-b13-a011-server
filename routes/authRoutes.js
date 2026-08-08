const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const connectDB = require("../utils/db");

const router = express.Router();

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
            console.error("JWT_SECRET is missing from environment variables.");

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
            console.error("JWT_SECRET is missing from environment variables.");

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

module.exports = router;