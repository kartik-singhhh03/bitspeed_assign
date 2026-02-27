import express from "express";

const app = express();
const PORT = 3000;

// Parse incoming JSON request bodies
app.use(express.json());

// Health check route
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Bitespeed Identity Reconciliation API is running",
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
