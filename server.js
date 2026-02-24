import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// проверка сервера
app.get("/", (req, res) => {
  res.send("GoPromo CRM backend is running 🚀");
});

// webhook Авито
app.post("/api/avito/webhook", async (req, res) => {
  res.sendStatus(200);
  console.log("Avito webhook:", req.body);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
