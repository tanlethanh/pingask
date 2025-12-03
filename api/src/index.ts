import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Ask } from "./endpoints/ask";

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for all origins (adjust for production)
app.use("/*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

const openapi = fromHono(app, { docs_url: "/openapi" });
openapi.get("/api/ask", Ask);

export default app;
