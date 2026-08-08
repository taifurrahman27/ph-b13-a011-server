const express = require("express");
const cors = require("cors");
require("dotenv").config();
const connectDB = require("./utils/db");

const authRoutes = require("./routes/authRoutes");

const app = express();

const PORT = process.env.PORT || 5000;

app.use(
    cors({
        origin: process.env.CLIENT_URL,
        credentials: true,
    })
);

app.use(express.json());
app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
    res.send("CrowdFunding server is running");
});
const startServer = async () => {
    try {
        await connectDB();

        app.listen(PORT, () => {
            console.log(`CrowdFunding server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
};

startServer();
