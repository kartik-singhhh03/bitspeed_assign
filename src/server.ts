import express from "express";
import { identifyContact } from "./identity.service";

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

// POST /identify
app.post("/identify", async (req, res) => {
  const { email, phoneNumber } = req.body;

  // At least one of email or phoneNumber must be provided
  if (!email && !phoneNumber) {
    res
      .status(400)
      .json({ error: "Please provide at least email or phoneNumber" });
    return;
  }

  try {
    const result = await identifyContact({ email, phoneNumber });
    res.status(200).json({ contact: result });
  } catch (error) {
    console.error("Error in /identify:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
