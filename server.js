// backend/server.js
import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { initDB } from "./db.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(session({
  secret: "bhc-secret-key",
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));
app.use(express.static(path.join(__dirname, "../public")));


let db;

(async function start() {
  try {
    db = await initDB();
    console.log("📚 SQLite DB ready.");

    // ========== BOOKS ==========
    app.get("/api/books", async (req, res) => {
      try {
        const q = req.query.q || "";
        let books;
        if (q) {
          const like = `%${q}%`;
          books = await db.all(
            "SELECT * FROM books WHERE title LIKE ? OR author LIKE ? OR category LIKE ? ORDER BY created_at DESC",
            [like, like, like]
          );
        } else {
          books = await db.all("SELECT *, COALESCE(status, 'available') AS status FROM books ORDER BY created_at DESC");

        }
        res.json({ success: true, data: books });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post("/api/books", async (req, res) => {
      try {
        const { title, author, category } = req.body;
        if (!title || !author)
          return res.status(400).json({ success: false, error: "Title and author are required." });
const result = await db.run(
  "INSERT INTO books (title, author, category, status) VALUES (?, ?, ?, 'available')",
  [title, author, category || ""]
);


        const book = await db.get("SELECT * FROM books WHERE id = ?", [result.lastID]);
        res.json({ success: true, data: book });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.put("/api/books/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { title, author, category } = req.body;
        await db.run("UPDATE books SET title = ?, author = ?, category = ? WHERE id = ?", [
          title,
          author,
          category || "",
          id,
        ]);
        const book = await db.get("SELECT * FROM books WHERE id = ?", [id]);
        res.json({ success: true, data: book });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.delete("/api/books/:id", async (req, res) => {
      try {
        const { id } = req.params;
        await db.run("DELETE FROM books WHERE id = ?", [id]);
        res.json({ success: true, message: "Book deleted" });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // ========== CONTACT & MESSAGES ==========
    app.post("/api/contact", async (req, res) => {
      try {
        const { name, email, subject, message } = req.body;
        if (!name || !email || !subject || !message)
          return res.status(400).json({ success: false, error: "All fields are required." });
        const r = await db.run(
          "INSERT INTO messages (name, email, subject, message) VALUES (?, ?, ?, ?)",
          [name, email, subject, message]
        );
        const saved = await db.get("SELECT * FROM messages WHERE id = ?", [r.lastID]);
        res.json({ success: true, data: saved });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.get("/api/messages", async (req, res) => {
      try {
        const msgs = await db.all("SELECT * FROM messages ORDER BY created_at DESC");
        res.json({ success: true, data: msgs });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

// Borrow a book
app.post("/api/borrow", async (req, res, next) => {
  try {
    const { book_id, return_date } = req.body;
    if (!req.session.user) {
      return res.status(401).json({ success: false, error: "Login required" });
    }

    const user_id = req.session.user.id;
    const book = await db.get("SELECT * FROM books WHERE id = ?", [book_id]);
    if (!book) return res.status(404).json({ success: false, error: "Book not found" });

    const existing = await db.get(
      "SELECT * FROM borrows WHERE book_id = ? AND status = 'borrowed'",
      [book_id]
    );
    if (existing) {
      return res.status(400).json({ success: false, error: "Book already borrowed" });
    }

    await db.run(
      "INSERT INTO borrows (book_id, user_id, return_date) VALUES (?, ?, ?)",
      [book_id, user_id, return_date]
    );
    await db.run("UPDATE books SET status = 'borrowed' WHERE id = ?", [book_id]);

    res.json({ success: true, message: "Book borrowed successfully." });
  } catch (err) {
    next(err);
  }
});

// Mark as returned (admin)
app.put("/api/borrows/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Get the borrow record
    const borrow = await db.get("SELECT * FROM borrows WHERE id = ?", [id]);
    if (!borrow) return res.status(404).json({ success: false, error: "Record not found" });

    // Update borrow record
    await db.run("UPDATE borrows SET status = ? WHERE id = ?", [status, id]);

    // If returned, update the book status
    if (status === "returned") {
      await db.run("UPDATE books SET status = 'available' WHERE id = ?", [borrow.book_id]);
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Student - their borrowed books
app.get("/api/borrowed", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false, error: "Not logged in" });
  const user_id = req.session.user.id;

  const borrows = await db.all(`
    SELECT 
      borrows.id,
      books.title,
      borrows.borrow_date,
      borrows.return_date,
      borrows.status
    FROM borrows
    JOIN books ON books.id = borrows.book_id
    WHERE borrows.user_id = ?
    ORDER BY borrows.borrow_date DESC
  `, [user_id]);

  res.json({ success: true, data: borrows });
});

// Admin - summary counts
app.get("/api/summary", async (req, res) => {
  try {
    const totalBooks = await db.get("SELECT COUNT(*) AS count FROM books");
    const borrowedBooks = await db.get("SELECT COUNT(*) AS count FROM borrows WHERE status = 'borrowed'");
    const totalUsers = await db.get("SELECT COUNT(*) AS count FROM users");
    res.json({
      success: true,
      totalBooks: totalBooks.count,
      borrowedBooks: borrowedBooks.count,
      totalUsers: totalUsers.count
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin - list users
app.get("/api/users", async (req, res) => {
  try {
    const users = await db.all("SELECT id, username AS name, role FROM users ORDER BY created_at DESC");
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ========== AUTH ==========

// REGISTER (student only)
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, error: "All fields required." });

    await db.run("INSERT INTO users (username, password, role) VALUES (?, ?, 'student')", [
      username,
      password
    ]);
    res.json({ success: true, message: "Registration successful. Please login." });
  } catch (err) {
    if (err.message.includes("UNIQUE constraint failed")) {
      res.status(400).json({ success: false, error: "Username already exists. Please choose another." });
    } else {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});


// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.get("SELECT * FROM users WHERE username = ? AND password = ?", [
      username,
      password
    ]);

    if (!user) return res.status(401).json({ success: false, error: "Invalid credentials" });

    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// LOGOUT
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, message: "Logged out" });
  });
});

// CHECK SESSION
app.get("/api/me", (req, res) => {
  if (req.session.user) {
    res.json({ success: true, user: req.session.user });
  } else {
    res.status(401).json({ success: false, error: "Not logged in" });
  }
});

    // fallback
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "../public/index.html"));
    });

    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
})();
