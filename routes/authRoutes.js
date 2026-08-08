const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const connectDB = require("../utils/db");

const router = express.Router();

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

        if (!["supporter", "creator"].includes(role)) {
            return res.status(400).json({
                message: "Invalid role.",
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
            return res.status(400).json({
                message: "Please provide a valid email address.",
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                message: "Password must be at least 8 characters long.",
            });
        }

        const db = await connectDB();
        const usersCollection = db.collection("users");

        const existingUser = await usersCollection.findOne({
            email: email.toLowerCase(),
        });

        if (existingUser) {
            return res.status(409).json({
                message: "An account with this email already exists.",
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const credits = role === "supporter" ? 50 : 20;

        const newUser = {
            name: name.trim(),
            email: email.toLowerCase(),
            profileImage: profileImage.trim(),
            password: hashedPassword,
            role,
            credits,
            createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);

        res.status(201).json({
            message: "Registration successful.",
            user: {
                id: result.insertedId,
                name: newUser.name,
                email: newUser.email,
                profileImage: newUser.profileImage,
                role: newUser.role,
                credits: newUser.credits,
            },
        });
    } catch (error) {
        console.error("Registration error:", error);

        res.status(500).json({
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

        const db = await connectDB();
        const usersCollection = db.collection("users");

        const user = await usersCollection.findOne({
            email: email.toLowerCase(),
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

        const token = jwt.sign(
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

        res.status(200).json({
            message: "Login successful.",
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                profileImage: user.profileImage,
                role: user.role,
                credits: user.credits,
            },
        });
    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            message: "Something went wrong during login.",
        });
    }
});

module.exports = router;