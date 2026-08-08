const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 5000;

app.use(
    cors({
        origin: "http://localhost:3000",
        credentials: true,
    })
);

app.use(express.json());

app.get("/", (req, res) => {
    res.send("CrowdFunding server is running");
});

app.listen(PORT, () => {
    console.log(`CrowdFunding server running on port ${PORT}`);
});
