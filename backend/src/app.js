const express = require("express");
const apiRouter = require("./routes/api");

const app = express();

app.use(express.json());
app.use("/api", apiRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    error: err.message || "Internal Server Error"
  });
});

module.exports = app;
