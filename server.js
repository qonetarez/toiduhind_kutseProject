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

const categories = [
  { id: 'all', name: 'Kõik kategooriad' },
  { id: 'piimatooted', name: 'Piimatooted' },
  { id: 'leivatooted', name: 'Leivatooted' },
  { id: 'munad', name: 'Munad' }
];

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
      return res.redirect('/profile');
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
  res.render('profile');
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

app.get('/admin/products/new', requireAdmin, (req, res) => {
  res.render('admin-product-new', {
    error: null,
    form: {},
    stores,
    categories
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

  if (!name || !categoryId) {
    return res.render('admin-product-new', {
      error: 'Nimi ja kategooria on kohustuslikud.',
      form: req.body,
      stores,
      categories
    });
  }

  const categoryObj = categories.find((c) => c.id === categoryId);
  const category = categoryObj ? categoryObj.name : categoryId;
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
  res.render('cart', { cart, total });
});

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
    return res.redirect(backUrl);
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
  res.redirect('/cart');
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
  res.redirect('/cart');
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

