// backend/db.js
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function initDB() {
  const db = await open({
    filename: path.join(__dirname, "database.sqlite"),
    driver: sqlite3.Database
  });

  // === USERS TABLE ===
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('admin','student')) NOT NULL DEFAULT 'student',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // === BOOKS TABLE ===
  await db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // === MESSAGES TABLE ===
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // === BORROWS TABLE ===
  await db.exec(`
    CREATE TABLE IF NOT EXISTS borrows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      borrow_date TEXT DEFAULT (DATE('now')),
      return_date TEXT,
      status TEXT DEFAULT 'borrowed',
      FOREIGN KEY (book_id) REFERENCES books(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // === Seed default books if empty ===
  const row = await db.get("SELECT COUNT(*) AS total FROM books");
  if (row.total === 0) {
    const seed = [
      ["Philippine Literature", "Bienvenido Lumbera", "Literature"],
      ["General Psychology", "Kendra Cherry", "Psychology"],
      ["Calculus", "George B. Thomas", "Mathematics"],
      ["Philippine Politics", "Randy M. Tuano", "Politics"]
    ];
    for (const [title, author, category] of seed) {
      await db.run("INSERT INTO books (title, author, category) VALUES (?, ?, ?)", [title, author, category]);
    }
  }

  // === Seed default admin account ===
  const admin = await db.get("SELECT * FROM users WHERE role = 'admin'");
  if (!admin) {
    await db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", [
      "admin",
      "admin123", // plain for now
      "admin"
    ]);
    console.log("✅ Default admin account created (admin / admin123)");
  }

  return db;
}
