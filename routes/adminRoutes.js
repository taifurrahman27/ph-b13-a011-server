const express = require("express");

const {
    getAllUsers,
    getUserById,
} = require("../controllers/adminController");

const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");

const router = express.Router();

router.get(
    "/users",
    verifyToken,
    verifyAdmin,
    getAllUsers
);

router.get(
    "/users/:id",
    verifyToken,
    verifyAdmin,
    getUserById
);

module.exports = router;
