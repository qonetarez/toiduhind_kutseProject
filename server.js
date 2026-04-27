require('dotenv').config();
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const app = express();
const PORT = process.env.PORT || 3000;

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ToiduHind.ee API',
      version: '1.0.0',
      description: 'API documentation for ToiduHind.ee Node.js project'
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: 'Local server'
      }
    ],
    tags: [
      { name: 'Public', description: 'Public product and home endpoints' },
      { name: 'Auth', description: 'Registration and login endpoints' },
      { name: 'Cart', description: 'Shopping cart endpoints' },
      { name: 'Admin', description: 'Admin panel endpoints' }
    ]
  },
  apis: [__filename]
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Database (SQLite)
const db = new sqlite3.Database(path.join(__dirname, 'toiduhind.db'));

db.serialize(() => {
  // Users table
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  // Add role column if it doesn't exist
  db.run(
    'ALTER TABLE users ADD COLUMN role TEXT DEFAULT "user"',
    (err) => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.error('Error adding role column:', err.message);
      }
    }
  );

  // Add username column if it doesn't exist
  db.run(
    'ALTER TABLE users ADD COLUMN username TEXT',
    (err) => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.error('Error adding username column:', err.message);
      }
    }
  );

  // Ensure username uniqueness when provided
  db.run(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username)',
    (err) => {
      if (err) {
        console.error('Error creating username index:', err.message);
      }
    }
  );

  // Categories table
  db.run(
    `CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  // Seed categories if empty
  db.get('SELECT COUNT(*) AS count FROM categories', (catErr, catRow) => {
    if (catErr) {
      console.error('Error counting categories:', catErr.message);
      return;
    }
    if (!catRow || catRow.count > 0) {
      return;
    }
    const catStmt = db.prepare('INSERT INTO categories (id, name) VALUES (?, ?)');
    defaultCategories.forEach((cat) => catStmt.run(cat.id, cat.name));
    catStmt.finalize();
  });

  // Products table
  db.run(
    `CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      category_id TEXT NOT NULL,
      image_url TEXT,
      prices_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  db.run(
    'ALTER TABLE products ADD COLUMN image_url TEXT',
    (err) => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.error('Error adding image_url column:', err.message);
      }
    }
  );

  // Product price history table
  db.run(
    `CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      store_id TEXT NOT NULL,
      price REAL NOT NULL,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      total REAL NOT NULL,
      bank TEXT NOT NULL,
      customer_first_name TEXT NOT NULL,
      customer_last_name TEXT NOT NULL,
      customer_user_number TEXT,
      customer_isikukood TEXT,
      customer_phone TEXT NOT NULL,
      customer_address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'paid',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  );

  db.run(
    'ALTER TABLE orders ADD COLUMN customer_user_number TEXT',
    (err) => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.error('Error adding customer_user_number column:', err.message);
      }
    }
  );

  db.run(
    'ALTER TABLE orders ADD COLUMN customer_isikukood TEXT',
    (err) => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.error('Error adding customer_isikukood column:', err.message);
      }
    }
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_slug TEXT NOT NULL,
      product_name TEXT NOT NULL,
      store_id TEXT NOT NULL,
      store_name TEXT NOT NULL,
      price REAL NOT NULL,
      qty INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS user_cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      image_url TEXT,
      store_id TEXT NOT NULL,
      store_name TEXT NOT NULL,
      price REAL NOT NULL,
      qty INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, slug, store_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  );

  // Seed products if table is empty
  db.get('SELECT COUNT(*) AS count FROM products', (err, row) => {
    if (err) {
      console.error('Error counting products:', err.message);
      return;
    }
    if (row && row.count === 0) {
      const insertStmt = db.prepare(
        'INSERT INTO products (slug, name, category, category_id, image_url, prices_json) VALUES (?, ?, ?, ?, ?, ?)'
      );
      seedProducts.forEach((p) => {
        insertStmt.run(
          p.slug,
          p.name,
          p.category,
          p.categoryId,
          p.imageUrl || null,
          JSON.stringify(p.prices)
        );
      });
      insertStmt.finalize();
    }
  });

  // Seed price history if empty
  db.get('SELECT COUNT(*) AS count FROM price_history', (historyErr, historyRow) => {
    if (historyErr) {
      console.error('Error counting price history:', historyErr.message);
      return;
    }
    if (!historyRow || historyRow.count > 0) {
      return;
    }

    db.all('SELECT id, prices_json FROM products', (productsErr, productRows) => {
      if (productsErr) {
        console.error('Error reading products for history seed:', productsErr.message);
        return;
      }

      const historyStmt = db.prepare(
        'INSERT INTO price_history (product_id, store_id, price, recorded_at) VALUES (?, ?, ?, ?)'
      );
      const now = new Date();
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

      productRows.forEach((pRow) => {
        const prices = JSON.parse(pRow.prices_json || '{}');
        Object.entries(prices).forEach(([storeId, currentPrice]) => {
          const cur = Number(currentPrice);
          if (!Number.isFinite(cur)) {
            return;
          }
          const monthPrice = Number((cur * 1.06).toFixed(2));
          const yearPrice = Number((cur * 1.18).toFixed(2));

          historyStmt.run(pRow.id, storeId, yearPrice, yearAgo.toISOString());
          historyStmt.run(pRow.id, storeId, monthPrice, monthAgo.toISOString());
          historyStmt.run(pRow.id, storeId, cur, now.toISOString());
        });
      });

      historyStmt.finalize();
    });
  });
});

// Simple in-memory data for store list (actual prices come from DB)
const stores = [
  { id: 'rimi', name: 'Rimi' },
  { id: 'prisma', name: 'Prisma' },
  { id: 'maxima', name: 'Maxima' },
  { id: 'coop', name: 'Coop' }
];

const defaultCategories = [
  { id: 'piimatooted', name: 'Piimatooted' },
  { id: 'leivatooted', name: 'Leivatooted' },
  { id: 'munad', name: 'Munad' }
];

const roles = ['user', 'admin', 'courier'];

// Seed products used to populate DB on first run
const seedProducts = [
  {
    slug: 'milk-1l',
    name: 'Piim 1L',
    category: 'Piimatooted',
    categoryId: 'piimatooted',
    imageUrl: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=500&q=80',
    prices: {
      rimi: 1.19,
      prisma: 1.15,
      maxima: 1.09,
      coop: 1.25
    }
  },
  {
    slug: 'bread-white',
    name: 'Sai valge',
    category: 'Leivatooted',
    categoryId: 'leivatooted',
    imageUrl: 'https://images.unsplash.com/photo-1608198093002-ad4e005484ec?auto=format&fit=crop&w=500&q=80',
    prices: {
      rimi: 1.49,
      prisma: 1.39,
      maxima: 1.29,
      coop: 1.45
    }
  },
  {
    slug: 'eggs-10',
    name: 'Munad 10 tk',
    category: 'Munad',
    categoryId: 'munad',
    imageUrl: 'https://images.unsplash.com/photo-1506976785307-8732e854ad03?auto=format&fit=crop&w=500&q=80',
    prices: {
      rimi: 2.19,
      prisma: 2.09,
      maxima: 1.99,
      coop: 2.15
    }
  },
  {
    slug: 'butter-200g',
    name: 'Või 200 g',
    category: 'Piimatooted',
    categoryId: 'piimatooted',
    imageUrl: 'https://images.unsplash.com/photo-1589985270958-b0c7f25cb14c?auto=format&fit=crop&w=500&q=80',
    prices: {
      rimi: 2.39,
      prisma: 2.29,
      maxima: 2.19,
      coop: 2.35
    }
  },
  {
    slug: 'black-bread',
    name: 'Rukkileib',
    category: 'Leivatooted',
    categoryId: 'leivatooted',
    imageUrl: 'https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&w=500&q=80',
    prices: {
      rimi: 1.89,
      prisma: 1.79,
      maxima: 1.69,
      coop: 1.75
    }
  }
];

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change_this_secret',
    resave: false,
    saveUninitialized: false
  })
);

// Make current user available in all views
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.query = '';
  res.locals.activeCategory = 'all';
  res.locals.sort = 'name_asc';
  const cart = Array.isArray(req.session.cart) ? req.session.cart : [];
  res.locals.cartCount = cart.reduce((sum, item) => sum + (item.qty || 0), 0);
  next();
});

function slugify(str) {
  const prepared = String(str)
    .toLowerCase()
    .replace(/[ä]/g, 'ae')
    .replace(/[ö]/g, 'oe')
    .replace(/[ü]/g, 'ue')
    .replace(/[õ]/g, 'o');

  const cleaned = prepared
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!cleaned) {
    return `product-${Date.now()}`;
  }

  return cleaned;
}

function getCategories(callback) {
  db.all('SELECT id, name FROM categories ORDER BY name ASC', (err, rows) => {
    if (err) {
      return callback(err, []);
    }
    return callback(null, rows || []);
  });
}

function getCategoriesWithAll(callback) {
  getCategories((err, rows) => {
    if (err) {
      return callback(err, []);
    }
    return callback(null, [{ id: 'all', name: 'Kõik kategooriad' }, ...rows]);
  });
}

function mergeCarts(sessionCart, dbCart) {
  const mergedMap = new Map();
  [...dbCart, ...sessionCart].forEach((item) => {
    const key = `${item.slug}::${item.storeId}`;
    if (!mergedMap.has(key)) {
      mergedMap.set(key, { ...item });
      return;
    }
    const existing = mergedMap.get(key);
    existing.qty = Number(existing.qty || 0) + Number(item.qty || 0);
    mergedMap.set(key, existing);
  });
  return Array.from(mergedMap.values());
}

function loadCartForUser(userId, callback) {
  db.all(
    `SELECT slug, name, image_url, store_id, store_name, price, qty
     FROM user_cart_items
     WHERE user_id = ?
     ORDER BY id ASC`,
    [userId],
    (err, rows) => {
      if (err) {
        return callback(err, []);
      }
      const cart = (rows || []).map((row) => ({
        slug: row.slug,
        name: row.name,
        imageUrl: row.image_url || '',
        storeId: row.store_id,
        storeName: row.store_name,
        price: Number(row.price),
        qty: Number(row.qty)
      }));
      return callback(null, cart);
    }
  );
}

function saveCartForUser(userId, cart, callback) {
  db.run('DELETE FROM user_cart_items WHERE user_id = ?', [userId], (deleteErr) => {
    if (deleteErr) {
      return callback(deleteErr);
    }
    if (!Array.isArray(cart) || cart.length === 0) {
      return callback(null);
    }

    const stmt = db.prepare(
      `INSERT INTO user_cart_items
        (user_id, slug, name, image_url, store_id, store_name, price, qty, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const nowIso = new Date().toISOString();
    cart.forEach((item) => {
      stmt.run(
        userId,
        item.slug,
        item.name,
        item.imageUrl || null,
        item.storeId,
        item.storeName,
        Number(item.price),
        Number(item.qty),
        nowIso
      );
    });
    stmt.finalize((insertErr) => callback(insertErr || null));
  });
}

function syncCartForCurrentUser(req, callback) {
  if (!req.session.user || !req.session.user.id) {
    return callback(null);
  }
  const cart = Array.isArray(req.session.cart) ? req.session.cart : [];
  return saveCartForUser(req.session.user.id, cart, callback);
}

function getBestPrice(prices) {
  const entries = Object.entries(prices || {});
  if (entries.length === 0) {
    return null;
  }
  const best = entries.reduce(
    (min, [storeId, price]) =>
      price < min.price ? { storeId, price } : min,
    { storeId: entries[0][0], price: entries[0][1] }
  );
  return best;
}

function computePriceChange(current, previous) {
  if (!Number.isFinite(previous) || previous === 0) {
    return null;
  }
  const diff = current - previous;
  const percent = (diff / previous) * 100;
  return { diff, percent };
}

function findClosestBefore(historyRows, targetDate) {
  const targetTs = targetDate.getTime();
  const eligible = historyRows
    .map((row) => ({
      ...row,
      ts: new Date(row.recorded_at).getTime()
    }))
    .filter((row) => Number.isFinite(row.ts) && row.ts <= targetTs)
    .sort((a, b) => b.ts - a.ts);

  if (eligible.length === 0) {
    return null;
  }
  return Number(eligible[0].price);
}

// Home page: list products with best price highlight
/**
 * @openapi
 * /:
 *   get:
 *     tags: [Public]
 *     summary: Render home page with products
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Product search query
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Category id filter
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [name_asc, name_desc, price_asc, price_desc]
 *         description: Sort mode
 *     responses:
 *       200:
 *         description: Rendered HTML page
 */
app.get('/', (req, res) => {
  const query = (req.query.q || '').toLowerCase();
  const activeCategory = req.query.category || 'all';
  const sort = req.query.sort || 'name_asc';

  getCategoriesWithAll((catErr, categories) => {
    if (catErr) {
      console.error(catErr);
      return res.status(500).send('Serveri viga');
    }

    db.all('SELECT * FROM products', (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Serveri viga');
    }

    const dbProducts = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category,
      categoryId: row.category_id,
      imageUrl: row.image_url || '',
      prices: JSON.parse(row.prices_json)
    }));

    const filteredProducts = dbProducts.filter((p) => {
      const matchesName = p.name.toLowerCase().includes(query);
      const matchesCategory =
        activeCategory === 'all' || p.categoryId === activeCategory;
      return matchesName && matchesCategory;
    });

    let productsWithBest = filteredProducts.map((p) => {
      const best = getBestPrice(p.prices);
      if (!best) {
        return { ...p, bestStoreId: null, bestPrice: null };
      }
      return { ...p, bestStoreId: best.storeId, bestPrice: best.price };
    });

    if (sort === 'name_desc') {
      productsWithBest.sort((a, b) => b.name.localeCompare(a.name));
    } else if (sort === 'price_asc') {
      productsWithBest.sort(
        (a, b) => (a.bestPrice ?? Number.MAX_VALUE) - (b.bestPrice ?? Number.MAX_VALUE)
      );
    } else if (sort === 'price_desc') {
      productsWithBest.sort((a, b) => (b.bestPrice ?? 0) - (a.bestPrice ?? 0));
    } else {
      productsWithBest.sort((a, b) => a.name.localeCompare(b.name));
    }

    const categoryCards = categories
      .filter((c) => c.id !== 'all')
      .map((cat) => {
        const count = dbProducts.filter((p) => p.categoryId === cat.id).length;
        return { ...cat, count };
      });

    const topProducts = [...productsWithBest]
      .filter((p) => typeof p.bestPrice === 'number')
      .sort((a, b) => a.bestPrice - b.bestPrice)
      .slice(0, 6);

    res.render('index', {
      stores,
      products: productsWithBest,
      query,
      categories,
      activeCategory,
      sort,
      categoryCards,
      topProducts
    });
  });
  });
});

// Auth routes
/**
 * @openapi
 * /register:
 *   get:
 *     tags: [Auth]
 *     summary: Render registration page
 *     responses:
 *       200:
 *         description: Rendered HTML page
 */
app.get('/register', (req, res) => {
  res.render('register', { error: null, form: { email: '', username: '' } });
});

/**
 * @openapi
 * /register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [email, username, password, confirmPassword]
 *             properties:
 *               email:
 *                 type: string
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               confirmPassword:
 *                 type: string
 *     responses:
 *       302:
 *         description: Redirect after registration
 */
app.post('/register', (req, res) => {
  const { email, username, password, confirmPassword } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedUsername = String(username || '').trim().toLowerCase();

  if (!normalizedEmail || !normalizedUsername || !password || !confirmPassword) {
    return res.render('register', {
      error: 'Täida kõik väljad.',
      form: { email: normalizedEmail, username: normalizedUsername }
    });
  }

  if (password !== confirmPassword) {
    return res.render('register', {
      error: 'Paroolid ei ühti.',
      form: { email: normalizedEmail, username: normalizedUsername }
    });
  }

  if (!/^[a-z0-9._-]{3,20}$/.test(normalizedUsername)) {
    return res.render('register', {
      error: 'Kasutajanimi peab olema 3-20 märki (a-z, 0-9, ., _, -).',
      form: { email: normalizedEmail, username: normalizedUsername }
    });
  }

  db.get(
    'SELECT id, email, username FROM users WHERE email = ? OR username = ?',
    [normalizedEmail, normalizedUsername],
    (err, existing) => {
      if (err) {
        console.error(err);
        return res.render('register', {
          error: 'Serveri viga. Proovi hiljem uuesti.',
          form: { email: normalizedEmail, username: normalizedUsername }
        });
      }

      if (existing) {
        const duplicateMsg =
          existing.email === normalizedEmail
            ? 'Sellise e-posti aadressiga kasutaja on juba olemas.'
            : 'Selline kasutajanimi on juba kasutusel.';
        return res.render('register', {
          error: duplicateMsg,
          form: { email: normalizedEmail, username: normalizedUsername }
        });
      }

      const passwordHash = bcrypt.hashSync(password, 10);

      db.get('SELECT COUNT(*) AS count FROM users', (countErr, row) => {
        if (countErr) {
          console.error(countErr);
          return res.render('register', {
            error: 'Serveri viga. Proovi hiljem uuesti.',
            form: { email: normalizedEmail, username: normalizedUsername }
          });
        }

        const isFirstUser = row && row.count === 0;
        const role = isFirstUser ? 'admin' : 'user';

        db.run(
          'INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, ?)',
          [normalizedEmail, normalizedUsername, passwordHash, role],
          function (insertErr) {
            if (insertErr) {
              console.error(insertErr);
              return res.render('register', {
                error: 'Serveri viga. Proovi hiljem uuesti.',
                form: { email: normalizedEmail, username: normalizedUsername }
              });
            }

            return res.redirect('/login');
          }
        );
      });
    }
  );
});

/**
 * @openapi
 * /login:
 *   get:
 *     tags: [Auth]
 *     summary: Render login page
 *     responses:
 *       200:
 *         description: Rendered HTML page
 */
app.get('/login', (req, res) => {
  res.render('login', { error: null, form: { identifier: '' } });
});

/**
 * @openapi
 * /login:
 *   post:
 *     tags: [Auth]
 *     summary: Login using email or username
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [identifier, password]
 *             properties:
 *               identifier:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       302:
 *         description: Redirect after login
 */
app.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  const normalizedIdentifier = String(identifier || '').trim().toLowerCase();

  if (!normalizedIdentifier || !password) {
    return res.render('login', {
      error: 'Sisesta e-post/kasutajanimi ja parool.',
      form: { identifier: normalizedIdentifier }
    });
  }

  db.get(
    'SELECT * FROM users WHERE email = ? OR username = ?',
    [normalizedIdentifier, normalizedIdentifier],
    (err, user) => {
      if (err) {
        console.error(err);
        return res.render('login', {
          error: 'Serveri viga. Proovi hiljem uuesti.',
          form: { identifier: normalizedIdentifier }
        });
      }

      if (!user) {
        return res.render('login', {
          error: 'Vale e-post/kasutajanimi või parool.',
          form: { identifier: normalizedIdentifier }
        });
      }

      const isValid = bcrypt.compareSync(password, user.password_hash);
      if (!isValid) {
        return res.render('login', {
          error: 'Vale e-post/kasutajanimi või parool.',
          form: { identifier: normalizedIdentifier }
        });
      }

      req.session.user = {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role || 'user'
      };

      const sessionCart = Array.isArray(req.session.cart) ? req.session.cart : [];
      loadCartForUser(user.id, (cartErr, dbCart) => {
        if (cartErr) {
          console.error(cartErr);
          return res.redirect('/profile');
        }

        const mergedCart = mergeCarts(sessionCart, dbCart);
        req.session.cart = mergedCart;
        saveCartForUser(user.id, mergedCart, (saveErr) => {
          if (saveErr) {
            console.error(saveErr);
          }
          return res.redirect('/profile');
        });
      });
    }
  );
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Simple protected page
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

app.get('/profile', requireAuth, (req, res) => {
  const userId = req.session.user && req.session.user.id;
  if (!userId) {
    return res.redirect('/login');
  }

  db.all(
    `SELECT *
     FROM orders
     WHERE user_id = ? AND status = 'paid'
     ORDER BY created_at DESC`,
    [userId],
    (err, orders) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Serveri viga');
      }

      if (!orders || orders.length === 0) {
        return res.render('profile', { orders: [] });
      }

      const orderIds = orders.map((o) => o.id);
      const placeholders = orderIds.map(() => '?').join(',');
      db.all(
        `SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id ASC`,
        orderIds,
        (itemsErr, items) => {
          if (itemsErr) {
            console.error(itemsErr);
            return res.status(500).send('Serveri viga');
          }

          const itemsByOrder = {};
          (items || []).forEach((item) => {
            if (!itemsByOrder[item.order_id]) {
              itemsByOrder[item.order_id] = [];
            }
            itemsByOrder[item.order_id].push(item);
          });

          const withItems = orders.map((order) => ({
            ...order,
            items: itemsByOrder[order.id] || []
          }));
          return res.render('profile', { orders: withItems });
        }
      );
    }
  );
});

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).send('Ainult administraatorile.');
  }
  next();
}

function requireCourier(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'courier') {
    return res.status(403).send('Ainult kullerile.');
  }
  next();
}

/**
 * @openapi
 * /api/users/role:
 *   post:
 *     tags: [Admin]
 *     summary: Update a user's role by email or username
 *     description: Local development helper endpoint to promote/demote users.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               email:
 *                 type: string
 *                 description: User email (required if username is not provided)
 *               username:
 *                 type: string
 *                 description: Username (required if email is not provided)
 *               role:
 *                 type: string
 *                 enum: [user, admin, courier]
 *     responses:
 *       200:
 *         description: Role updated
 *       400:
 *         description: Invalid input
 *       404:
 *         description: User not found
 */
app.post('/api/users/role', express.json(), (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const username = String(req.body.username || '').trim().toLowerCase();
  const role = String(req.body.role || '').trim().toLowerCase();

  if (!email && !username) {
    return res.status(400).json({
      error: 'Provide email or username.'
    });
  }

  if (!roles.includes(role)) {
    return res.status(400).json({
      error: 'Role must be one of: user, admin, courier.'
    });
  }

  const lookupColumn = email ? 'email' : 'username';
  const lookupValue = email || username;

  db.run(
    `UPDATE users SET role = ? WHERE ${lookupColumn} = ?`,
    [role, lookupValue],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({
          error: 'Server error while updating role.'
        });
      }

      if (!this.changes) {
        return res.status(404).json({
          error: 'User not found.'
        });
      }

      return res.json({
        message: 'Role updated successfully.',
        role
      });
    }
  );
});

// Admin product management
/**
 * @openapi
 * /admin/products:
 *   get:
 *     tags: [Admin]
 *     summary: Admin products list page
 *     responses:
 *       200:
 *         description: Rendered HTML page
 *       403:
 *         description: Forbidden
 */
app.get('/admin/products', requireAdmin, (req, res) => {
  db.all('SELECT * FROM products ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Serveri viga');
    }

    const products = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category,
      categoryId: row.category_id,
      imageUrl: row.image_url || '',
      prices: JSON.parse(row.prices_json)
    }));

    res.render('admin-products', {
      products,
      stores
    });
  });
});

app.post('/admin/products/:id/delete', requireAdmin, (req, res) => {
  const productId = parseInt(req.params.id, 10);
  if (!Number.isInteger(productId)) {
    return res.redirect('/admin/products');
  }

  db.run('DELETE FROM price_history WHERE product_id = ?', [productId], (historyErr) => {
    if (historyErr) {
      console.error(historyErr);
      return res.status(500).send('Serveri viga');
    }

    db.run('DELETE FROM products WHERE id = ?', [productId], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Serveri viga');
      }
      return res.redirect('/admin/products');
    });
  });
});

app.get('/admin/products/new', requireAdmin, (req, res) => {
  getCategories((err, categories) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Serveri viga');
    }
    res.render('admin-product-new', {
      error: null,
      form: {},
      stores,
      categories
    });
  });
});

app.get('/admin/products/:id/edit', requireAdmin, (req, res) => {
  const productId = parseInt(req.params.id, 10);
  if (!Number.isInteger(productId)) {
    return res.redirect('/admin/products');
  }

  getCategories((catErr, categories) => {
    if (catErr) {
      console.error(catErr);
      return res.status(500).send('Serveri viga');
    }

    db.get('SELECT * FROM products WHERE id = ?', [productId], (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Serveri viga');
      }
      if (!row) {
        return res.redirect('/admin/products');
      }

      const parsedPrices = JSON.parse(row.prices_json || '{}');
      const form = {
        name: row.name,
        categoryId: row.category_id,
        slug: row.slug,
        imageUrl: row.image_url || ''
      };
      stores.forEach((store) => {
        form[`price_${store.id}`] =
          typeof parsedPrices[store.id] === 'number' ? String(parsedPrices[store.id]) : '';
      });

      return res.render('admin-product-edit', {
        error: null,
        form,
        stores,
        categories,
        productId
      });
    });
  });
});

/**
 * @openapi
 * /admin/products:
 *   post:
 *     tags: [Admin]
 *     summary: Create a new product from admin panel
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [name, categoryId]
 *             properties:
 *               name:
 *                 type: string
 *               categoryId:
 *                 type: string
 *               slug:
 *                 type: string
 *     responses:
 *       302:
 *         description: Redirect after create
 */
app.post('/admin/products', requireAdmin, (req, res) => {
  const { name, categoryId, slug: rawSlug, imageUrl } = req.body;
  getCategories((catErr, categories) => {
    if (catErr) {
      console.error(catErr);
      return res.status(500).send('Serveri viga');
    }

    if (!name || !categoryId) {
      return res.render('admin-product-new', {
        error: 'Nimi ja kategooria on kohustuslikud.',
        form: req.body,
        stores,
        categories
      });
    }

    const categoryObj = categories.find((c) => c.id === categoryId);
    if (!categoryObj) {
      return res.render('admin-product-new', {
        error: 'Valitud kategooriat ei leitud.',
        form: req.body,
        stores,
        categories
      });
    }
    const category = categoryObj.name;
    const slug = rawSlug && rawSlug.trim().length > 0 ? slugify(rawSlug) : slugify(name);

    const prices = {};
    stores.forEach((store) => {
      const raw = req.body[`price_${store.id}`];
      if (raw !== undefined && raw !== '') {
        const num = parseFloat(raw);
        if (!Number.isNaN(num)) {
          prices[store.id] = num;
        }
      }
    });

    if (Object.keys(prices).length === 0) {
      return res.render('admin-product-new', {
        error: 'Lisa vähemalt ühe poe hind.',
        form: req.body,
        stores,
        categories
      });
    }

    db.run(
      'INSERT INTO products (slug, name, category, category_id, image_url, prices_json) VALUES (?, ?, ?, ?, ?, ?)',
      [slug, name, category, categoryId, String(imageUrl || '').trim() || null, JSON.stringify(prices)],
      function (err) {
        if (err) {
          console.error(err);
          const isUnique =
            String(err.message).includes('UNIQUE') ||
            String(err.message).includes('unique');
          return res.render('admin-product-new', {
            error: isUnique
              ? 'Sellise slugiga toode on juba olemas.'
              : 'Serveri viga. Proovi hiljem uuesti.',
            form: req.body,
            stores,
            categories
          });
        }

        const productId = this.lastID;
        const historyStmt = db.prepare(
          'INSERT INTO price_history (product_id, store_id, price, recorded_at) VALUES (?, ?, ?, ?)'
        );
        const nowIso = new Date().toISOString();
        Object.entries(prices).forEach(([storeId, price]) => {
          historyStmt.run(productId, storeId, Number(price), nowIso);
        });
        historyStmt.finalize(() => {
          return res.redirect('/admin/products');
        });
      }
    );
  });
});

app.post('/admin/products/:id', requireAdmin, (req, res) => {
  const productId = parseInt(req.params.id, 10);
  if (!Number.isInteger(productId)) {
    return res.redirect('/admin/products');
  }

  const { name, categoryId, slug: rawSlug, imageUrl } = req.body;
  getCategories((catErr, categories) => {
    if (catErr) {
      console.error(catErr);
      return res.status(500).send('Serveri viga');
    }

    const renderEditError = (errorMessage) =>
      res.render('admin-product-edit', {
        error: errorMessage,
        form: req.body,
        stores,
        categories,
        productId
      });

    if (!name || !categoryId) {
      return renderEditError('Nimi ja kategooria on kohustuslikud.');
    }

    const categoryObj = categories.find((c) => c.id === categoryId);
    if (!categoryObj) {
      return renderEditError('Valitud kategooriat ei leitud.');
    }
    const category = categoryObj.name;
    const slug = rawSlug && rawSlug.trim().length > 0 ? slugify(rawSlug) : slugify(name);

    const prices = {};
    stores.forEach((store) => {
      const raw = req.body[`price_${store.id}`];
      if (raw !== undefined && raw !== '') {
        const num = parseFloat(raw);
        if (!Number.isNaN(num)) {
          prices[store.id] = num;
        }
      }
    });

    if (Object.keys(prices).length === 0) {
      return renderEditError('Lisa vähemalt ühe poe hind.');
    }

    db.run(
      `UPDATE products
       SET slug = ?, name = ?, category = ?, category_id = ?, image_url = ?, prices_json = ?
       WHERE id = ?`,
      [
        slug,
        name,
        category,
        categoryId,
        String(imageUrl || '').trim() || null,
        JSON.stringify(prices),
        productId
      ],
      function (err) {
        if (err) {
          console.error(err);
          const isUnique =
            String(err.message).includes('UNIQUE') ||
            String(err.message).includes('unique');
          return renderEditError(
            isUnique ? 'Sellise slugiga toode on juba olemas.' : 'Serveri viga. Proovi hiljem uuesti.'
          );
        }
        if (!this.changes) {
          return res.redirect('/admin/products');
        }

        db.run('DELETE FROM price_history WHERE product_id = ?', [productId], (deleteErr) => {
          if (deleteErr) {
            console.error(deleteErr);
            return res.status(500).send('Serveri viga');
          }

          const historyStmt = db.prepare(
            'INSERT INTO price_history (product_id, store_id, price, recorded_at) VALUES (?, ?, ?, ?)'
          );
          const nowIso = new Date().toISOString();
          Object.entries(prices).forEach(([storeId, price]) => {
            historyStmt.run(productId, storeId, Number(price), nowIso);
          });
          historyStmt.finalize(() => res.redirect('/admin/products'));
        });
      }
    );
  });
});

app.get('/admin/categories', requireAdmin, (req, res) => {
  getCategories((err, categories) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Serveri viga');
    }
    res.render('admin-categories', {
      categories,
      error: req.query.error || null,
      success: req.query.success || null
    });
  });
});

app.post('/admin/categories', requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim();
  const rawId = String(req.body.id || '').trim();
  const id = slugify(rawId || name);
  if (!name || !id) {
    return res.redirect('/admin/categories?error=Taida+koik+valjad');
  }

  db.run('INSERT INTO categories (id, name) VALUES (?, ?)', [id, name], (err) => {
    if (err) {
      console.error(err);
      return res.redirect('/admin/categories?error=Kategooriat+ei+saanud+lisada');
    }
    return res.redirect('/admin/categories?success=Kategooria+lisatud');
  });
});

app.post('/admin/categories/:id', requireAdmin, (req, res) => {
  const currentId = String(req.params.id || '').trim();
  const name = String(req.body.name || '').trim();
  const newId = slugify(String(req.body.id || '').trim());

  if (!currentId || !name || !newId) {
    return res.redirect('/admin/categories?error=Vale+sisend+kategooria+uuendamisel');
  }

  db.run(
    'UPDATE categories SET id = ?, name = ? WHERE id = ?',
    [newId, name, currentId],
    function (err) {
      if (err) {
        console.error(err);
        return res.redirect('/admin/categories?error=Kategooriat+ei+saanud+muuta');
      }
      if (!this.changes) {
        return res.redirect('/admin/categories?error=Kategooriat+ei+leitud');
      }

      db.run(
        'UPDATE products SET category_id = ?, category = ? WHERE category_id = ?',
        [newId, name, currentId],
        (productErr) => {
          if (productErr) {
            console.error(productErr);
            return res.redirect('/admin/categories?error=Toodete+kategooriat+ei+saanud+uuendada');
          }
          return res.redirect('/admin/categories?success=Kategooria+uuendatud');
        }
      );
    }
  );
});

app.post('/admin/categories/:id/delete', requireAdmin, (req, res) => {
  const categoryId = String(req.params.id || '').trim();
  if (!categoryId) {
    return res.redirect('/admin/categories?error=Vale+kategooria');
  }

  db.get(
    'SELECT COUNT(*) AS count FROM products WHERE category_id = ?',
    [categoryId],
    (countErr, row) => {
      if (countErr) {
        console.error(countErr);
        return res.redirect('/admin/categories?error=Serveri+viga');
      }

      if (row && row.count > 0) {
        return res.redirect('/admin/categories?error=Kategooriat+ei+saa+kustutada,+tooted+on+sellega+seotud');
      }

      db.run('DELETE FROM categories WHERE id = ?', [categoryId], function (err) {
        if (err) {
          console.error(err);
          return res.redirect('/admin/categories?error=Kategooriat+ei+saanud+kustutada');
        }
        if (!this.changes) {
          return res.redirect('/admin/categories?error=Kategooriat+ei+leitud');
        }
        return res.redirect('/admin/categories?success=Kategooria+kustutatud');
      });
    }
  );
});

app.get('/admin/users', requireAdmin, (req, res) => {
  db.all(
    'SELECT id, email, username, role, created_at FROM users ORDER BY created_at DESC',
    (err, users) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Serveri viga');
      }
      res.render('admin-users', {
        users: users || [],
        roles,
        error: req.query.error || null,
        success: req.query.success || null
      });
    }
  );
});

app.get('/admin/users/new', requireAdmin, (req, res) => {
  res.render('admin-user-new', {
    roles,
    error: null,
    form: { email: '', username: '', role: 'user' }
  });
});

app.post('/admin/users', requireAdmin, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = String(req.body.role || '').trim().toLowerCase();

  if (!email || !username || !password || !roles.includes(role)) {
    return res.render('admin-user-new', {
      roles,
      error: 'Taida koik valjad ja vali korrektne roll.',
      form: { email, username, role }
    });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  db.run(
    'INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, ?)',
    [email, username, passwordHash, role],
    (err) => {
      if (err) {
        console.error(err);
        return res.render('admin-user-new', {
          roles,
          error: 'Kasutajat ei saanud lisada (email voi kasutajanimi voib olla juba olemas).',
          form: { email, username, role }
        });
      }
      return res.redirect('/admin/users?success=Kasutaja+lisatud');
    }
  );
});

app.post('/admin/users/:id', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const email = String(req.body.email || '').trim().toLowerCase();
  const username = String(req.body.username || '').trim().toLowerCase();
  const role = String(req.body.role || '').trim().toLowerCase();
  const password = String(req.body.password || '').trim();

  if (!Number.isInteger(userId) || !email || !username || !roles.includes(role)) {
    return res.redirect('/admin/users?error=Vale+sisend+kasutaja+uuendamisel');
  }

  const applyUpdate = (passwordHash) => {
    const sql = passwordHash
      ? 'UPDATE users SET email = ?, username = ?, role = ?, password_hash = ? WHERE id = ?'
      : 'UPDATE users SET email = ?, username = ?, role = ? WHERE id = ?';
    const params = passwordHash
      ? [email, username, role, passwordHash, userId]
      : [email, username, role, userId];

    db.run(sql, params, function (err) {
      if (err) {
        console.error(err);
        return res.redirect('/admin/users?error=Kasutajat+ei+saanud+uuendada');
      }
      if (!this.changes) {
        return res.redirect('/admin/users?error=Kasutajat+ei+leitud');
      }

      if (req.session.user && req.session.user.id === userId) {
        req.session.user.email = email;
        req.session.user.username = username;
        req.session.user.role = role;
      }
      return res.redirect('/admin/users?success=Kasutaja+uuendatud');
    });
  };

  if (password) {
    return applyUpdate(bcrypt.hashSync(password, 10));
  }
  return applyUpdate(null);
});

app.post('/admin/users/:id/delete', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!Number.isInteger(userId)) {
    return res.redirect('/admin/users?error=Vale+kasutaja+ID');
  }

  if (req.session.user && req.session.user.id === userId) {
    return res.redirect('/admin/users?error=Sa+ei+saa+enda+kontot+kustutada');
  }

  db.run('DELETE FROM users WHERE id = ?', [userId], function (err) {
    if (err) {
      console.error(err);
      return res.redirect('/admin/users?error=Kasutajat+ei+saanud+kustutada');
    }
    if (!this.changes) {
      return res.redirect('/admin/users?error=Kasutajat+ei+leitud');
    }
    return res.redirect('/admin/users?success=Kasutaja+kustutatud');
  });
});

app.get('/courier/orders', requireCourier, (req, res) => {
  db.all(
    `SELECT o.*, u.email AS user_email, u.username AS user_username
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     WHERE o.status = 'paid'
     ORDER BY o.created_at DESC`,
    (err, orders) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Serveri viga');
      }

      if (!orders || orders.length === 0) {
        return res.render('courier-orders', { orders: [] });
      }

      const orderIds = orders.map((o) => o.id);
      const placeholders = orderIds.map(() => '?').join(',');
      db.all(
        `SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id ASC`,
        orderIds,
        (itemsErr, items) => {
          if (itemsErr) {
            console.error(itemsErr);
            return res.status(500).send('Serveri viga');
          }

          const itemsByOrder = {};
          (items || []).forEach((item) => {
            if (!itemsByOrder[item.order_id]) {
              itemsByOrder[item.order_id] = [];
            }
            itemsByOrder[item.order_id].push(item);
          });

          const withItems = orders.map((order) => ({
            ...order,
            items: itemsByOrder[order.id] || []
          }));

          return res.render('courier-orders', { orders: withItems });
        }
      );
    }
  );
});

// Cart
/**
 * @openapi
 * /cart:
 *   get:
 *     tags: [Cart]
 *     summary: Render shopping cart page
 *     responses:
 *       200:
 *         description: Rendered HTML page
 */
app.get('/cart', (req, res) => {
  const cart = Array.isArray(req.session.cart) ? req.session.cart : [];
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const paymentStatus = req.query.payment;
  const paymentBank = String(req.query.bank || '').trim().toLowerCase();
  const paymentBankLabels = {
    swedbank: 'Swedbank',
    seb: 'SEB',
    lhv: 'LHV',
    luminor: 'Luminor',
    applepay: 'Apple Pay'
  };

  res.render('cart', {
    cart,
    total,
    paymentError:
      paymentStatus === 'error'
        ? 'Makse ebaonnestus. Kontrolli andmeid ja proovi uuesti.'
        : null,
    paymentSuccess:
      paymentStatus === 'success'
        ? `Makse on kinnitatud (${paymentBankLabels[paymentBank] || 'internetipank'}). Aitah ostu eest!`
        : null
  });
});

function getBankLabel(bankId) {
  const labels = {
    swedbank: 'Swedbank',
    seb: 'SEB',
    lhv: 'LHV',
    luminor: 'Luminor',
    applepay: 'Apple Pay'
  };
  return labels[bankId] || bankId;
}

function getExternalBankUrl(bankId) {
  const links = {
    swedbank: 'https://www.swedbank.ee/private',
    seb: 'https://www.seb.ee',
    lhv: 'https://www.lhv.ee',
    luminor: 'https://www.luminor.ee',
    applepay: 'https://www.apple.com/apple-pay/'
  };
  return links[bankId] || null;
}

/**
 * @openapi
 * /cart/add:
 *   post:
 *     tags: [Cart]
 *     summary: Add product to cart
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [slug]
 *             properties:
 *               slug:
 *                 type: string
 *               storeId:
 *                 type: string
 *               qty:
 *                 type: integer
 *     responses:
 *       302:
 *         description: Redirect after adding item
 */
app.post('/cart/add', (req, res) => {
  const { slug, storeId, qty } = req.body;
  const quantity = Math.max(1, parseInt(qty, 10) || 1);

  db.get('SELECT * FROM products WHERE slug = ?', [slug], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Serveri viga');
    }
    if (!row) {
      return res.status(404).render('not-found');
    }

    const prices = JSON.parse(row.prices_json);
    const selectedStoreId = prices[storeId] !== undefined ? storeId : Object.keys(prices)[0];
    if (!selectedStoreId) {
      return res.redirect('/');
    }

    const price = Number(prices[selectedStoreId]);
    const storeName = stores.find((s) => s.id === selectedStoreId)?.name || selectedStoreId;

    if (!Array.isArray(req.session.cart)) {
      req.session.cart = [];
    }

    const existing = req.session.cart.find(
      (item) => item.slug === row.slug && item.storeId === selectedStoreId
    );

    if (existing) {
      existing.qty += quantity;
    } else {
      req.session.cart.push({
        slug: row.slug,
        name: row.name,
        imageUrl: row.image_url || '',
        storeId: selectedStoreId,
        storeName,
        price,
        qty: quantity
      });
    }

    const backUrl = req.body.backUrl || `/product/${row.slug}`;
    syncCartForCurrentUser(req, (syncErr) => {
      if (syncErr) {
        console.error(syncErr);
      }
      return res.redirect(backUrl);
    });
  });
});

/**
 * @openapi
 * /cart/remove:
 *   post:
 *     tags: [Cart]
 *     summary: Remove item from cart
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [slug, storeId]
 *             properties:
 *               slug:
 *                 type: string
 *               storeId:
 *                 type: string
 *     responses:
 *       302:
 *         description: Redirect after removal
 */
app.post('/cart/remove', (req, res) => {
  const { slug, storeId } = req.body;
  const cart = Array.isArray(req.session.cart) ? req.session.cart : [];
  req.session.cart = cart.filter((item) => !(item.slug === slug && item.storeId === storeId));
  syncCartForCurrentUser(req, (syncErr) => {
    if (syncErr) {
      console.error(syncErr);
    }
    res.redirect('/cart');
  });
});

/**
 * @openapi
 * /cart/clear:
 *   post:
 *     tags: [Cart]
 *     summary: Clear all cart items
 *     responses:
 *       302:
 *         description: Redirect after clear
 */
app.post('/cart/clear', (req, res) => {
  req.session.cart = [];
  syncCartForCurrentUser(req, (syncErr) => {
    if (syncErr) {
      console.error(syncErr);
    }
    res.redirect('/cart');
  });
});

app.get('/checkout', requireAuth, (req, res) => {
  const cart = Array.isArray(req.session.cart) ? req.session.cart : [];
  if (cart.length === 0) {
    return res.redirect('/cart');
  }

  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const draft = req.session.checkoutDraft || {};
  return res.render('checkout', {
    cart,
    total,
    error: null,
    form: {
      firstName: draft.firstName || '',
      lastName: draft.lastName || '',
      phone: draft.phone || '',
      address: draft.address || '',
      bank: draft.bank || 'swedbank'
    }
  });
});

app.post('/checkout', requireAuth, (req, res) => {
  const cart = Array.isArray(req.session.cart) ? req.session.cart : [];
  if (cart.length === 0) {
    return res.redirect('/cart');
  }

  const firstName = String(req.body.firstName || '').trim();
  const lastName = String(req.body.lastName || '').trim();
  const phone = String(req.body.phone || '').trim();
  const address = String(req.body.address || '').trim();
  const bank = String(req.body.bank || '').trim().toLowerCase();
  const allowedBanks = ['swedbank', 'seb', 'lhv', 'luminor', 'applepay'];

  if (!firstName || !lastName || !phone || !address || !allowedBanks.includes(bank)) {
    const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    return res.status(400).render('checkout', {
      cart,
      total,
      error: 'Palun täida kõik väljad ja vali korrektne pank.',
      form: { firstName, lastName, phone, address, bank }
    });
  }

  req.session.checkoutDraft = {
    firstName,
    lastName,
    phone,
    address,
    bank
  };
  return res.redirect(`/checkout/bank/${encodeURIComponent(bank)}`);
});

app.get('/checkout/bank/:bank', requireAuth, (req, res) => {
  const bank = String(req.params.bank || '').trim().toLowerCase();
  const allowedBanks = ['swedbank', 'seb', 'lhv', 'luminor', 'applepay'];
  const cart = Array.isArray(req.session.cart) ? req.session.cart : [];
  const draft = req.session.checkoutDraft || null;

  if (!allowedBanks.includes(bank) || !draft || draft.bank !== bank || cart.length === 0) {
    return res.redirect('/checkout');
  }

  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  return res.render('checkout-bank', {
    bank,
    bankLabel: getBankLabel(bank),
    draft,
    total,
    error: null,
    paymentForm: {
      userNumber: String(req.session.user.id || ''),
      isikukood: ''
    }
  });
});

app.post('/checkout/confirm', requireAuth, (req, res) => {
  const bank = String(req.body.bank || '').trim().toLowerCase();
  const userNumber = String(req.body.userNumber || '').trim();
  const isikukood = String(req.body.isikukood || '').trim();
  const draft = req.session.checkoutDraft || null;
  const cart = Array.isArray(req.session.cart) ? req.session.cart : [];

  if (!draft || draft.bank !== bank || cart.length === 0) {
    return res.redirect('/checkout');
  }

  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  if (!userNumber || !isikukood) {
    return res.status(400).render('checkout-bank', {
      bank,
      bankLabel: getBankLabel(bank),
      draft,
      total,
      error: 'Palun sisesta kasutaja number ja isikukood.',
      paymentForm: { userNumber, isikukood }
    });
  }

  db.run(
    `INSERT INTO orders
      (
        user_id,
        total,
        bank,
        customer_first_name,
        customer_last_name,
        customer_user_number,
        customer_isikukood,
        customer_phone,
        customer_address,
        status
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid')`,
    [
      req.session.user.id,
      total,
      bank,
      draft.firstName,
      draft.lastName,
      userNumber,
      isikukood,
      draft.phone,
      draft.address
    ],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).send('Serveri viga');
      }

      const orderId = this.lastID;
      const itemStmt = db.prepare(
        `INSERT INTO order_items
          (order_id, product_slug, product_name, store_id, store_name, price, qty)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      cart.forEach((item) => {
        itemStmt.run(
          orderId,
          item.slug,
          item.name,
          item.storeId,
          item.storeName,
          Number(item.price),
          Number(item.qty)
        );
      });

      itemStmt.finalize((itemsErr) => {
        if (itemsErr) {
          console.error(itemsErr);
          return res.status(500).send('Serveri viga');
        }

        req.session.cart = [];
        req.session.checkoutDraft = null;
        syncCartForCurrentUser(req, (syncErr) => {
          if (syncErr) {
            console.error(syncErr);
          }
          return res.redirect(`/cart?payment=success&bank=${encodeURIComponent(bank)}`);
        });
      });
    }
  );
});

// Product details page
/**
 * @openapi
 * /product/{slug}:
 *   get:
 *     tags: [Public]
 *     summary: Render product page by slug or id
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         description: Product slug (or numeric id)
 *     responses:
 *       200:
 *         description: Rendered HTML page
 *       404:
 *         description: Product not found
 */
app.get('/product/:slug', (req, res) => {
  const slug = req.params.slug;
  db.get('SELECT * FROM products WHERE slug = ? OR CAST(id AS TEXT) = ?', [slug, slug], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Serveri viga');
    }
    if (!row) {
      return res.status(404).render('not-found');
    }

    const product = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category,
      categoryId: row.category_id,
      imageUrl: row.image_url || '',
      prices: JSON.parse(row.prices_json)
    };
    const best = getBestPrice(product.prices);

    db.all(
      'SELECT store_id, price, recorded_at FROM price_history WHERE product_id = ?',
      [row.id],
      (historyErr, historyRows) => {
        if (historyErr) {
          console.error(historyErr);
          return res.status(500).send('Serveri viga');
        }

        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        const byStore = {};
        historyRows.forEach((hRow) => {
          if (!byStore[hRow.store_id]) {
            byStore[hRow.store_id] = [];
          }
          byStore[hRow.store_id].push(hRow);
        });

        const priceStats = {};
        Object.keys(product.prices).forEach((storeId) => {
          const current = Number(product.prices[storeId]);
          const rowsForStore = byStore[storeId] || [];
          const monthPrice = findClosestBefore(rowsForStore, monthAgo);
          const yearPrice = findClosestBefore(rowsForStore, yearAgo);
          priceStats[storeId] = {
            monthPrice,
            yearPrice,
            monthChange: computePriceChange(current, monthPrice),
            yearChange: computePriceChange(current, yearPrice)
          };
        });

        res.render('product', {
          stores,
          product,
          bestStoreId: best ? best.storeId : null,
          priceStats
        });
      }
    );
    
  });
});

app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Simple 404 fallback
app.use((req, res) => {
  res.status(404).render('not-found');
});

app.listen(PORT, () => {
  console.log(`ToiduHind.ee Node server running on http://localhost:${PORT}`);
});

