const { port } = require("./config/env");
const app = require("./app");

app.listen(port, () => {
  console.log(`Mastervolt Logging backend running on port ${port}`);
});
