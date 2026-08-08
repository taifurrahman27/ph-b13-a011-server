const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;

if (!uri) {
    throw new Error("MONGODB_URI is not defined");
}

const client = new MongoClient(uri);

let db;

const connectDB = async () => {
    if (db) {
        return db;
    }

    await client.connect();

    db = client.db(process.env.DB_NAME);

    console.log("MongoDB connected successfully");

    return db;
};

module.exports = connectDB;
