require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(40) NOT NULL,
      company VARCHAR(150),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_login_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("Neon PostgreSQL connected & users table ready.");
}

app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET || "boat-showcase-secret"));

// Serve static product image
app.use(
  "/product.jpg",
  express.static(path.join(__dirname, "public", "product.jpg")),
);

// Entry Point
app.get("/", (req, res) => {
  if (req.signedCookies.user_email) {
    return res.redirect("/showcase");
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Sign Up API
app.post("/api/signup", async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const phone = (req.body.phone || "").trim();
    const company = (req.body.company || "").trim();

    if (!name || !email || !phone) {
      return res
        .status(400)
        .json({ error: "Name, email, and phone number are required." });
    }

    const result = await pool.query(
      `INSERT INTO users (name, email, phone, company)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name,
           phone = EXCLUDED.phone,
           company = EXCLUDED.company,
           last_login_at = NOW()
       RETURNING id, name, email;`,
      [name, email, phone, company],
    );

    res.cookie("user_email", result.rows[0].email, {
      httpOnly: true,
      signed: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Database error during sign up." });
  }
});

// Log In API: Checks if BOTH email and phone number exist in Neon PostgreSQL
app.post("/api/login", async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const phone = (req.body.phone || "").trim();

    if (!email || !phone) {
      return res
        .status(400)
        .json({ error: "Please enter both your email and phone number." });
    }

    const result = await pool.query(
      `UPDATE users
       SET last_login_at = NOW()
       WHERE email = $1 AND phone = $2
       RETURNING id, email;`,
      [email, phone],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error:
          "Account not found with this email and phone number. Please sign up first.",
        needsSignup: true,
      });
    }

    res.cookie("user_email", result.rows[0].email, {
      httpOnly: true,
      signed: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Database error during login." });
  }
});

// Protected Product Showcase Page
app.get("/showcase", (req, res) => {
  if (!req.signedCookies.user_email) {
    return res.redirect("/");
  }

  const htmlPath = path.join(__dirname, "public", "showcase.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  html = html.replace(
    "__ELEVENLABS_AGENT_ID__",
    process.env.ELEVENLABS_AGENT_ID || "",
  );
  res.send(html);
});

// Logout API
app.post("/api/logout", (req, res) => {
  res.clearCookie("user_email");
  res.json({ ok: true });
});

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to Neon PostgreSQL:", err);
    process.exit(1);
  });
