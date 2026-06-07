import express from "express";
import { getUser } from "./db";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/user", getUser);

app.listen(PORT, () => {
  console.log(`ts-app-fixture listening on port ${PORT}`);
});
