require('dotenv').config();
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

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

  // Products table
  db.run(
    `CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      category_id TEXT NOT NULL,
      prices_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
        'INSERT INTO products (slug, name, category, category_id, prices_json) VALUES (?, ?, ?, ?, ?)'
      );
      seedProducts.forEach((p) => {
        insertStmt.run(
          p.slug,
          p.name,
          p.category,
          p.categoryId,
          JSON.stringify(p.prices)
        );
      });
      insertStmt.finalize();
    }
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
  next();
});

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
}

// Home page: list products with best price highlight
app.get('/', (req, res) => {
  const query = (req.query.q || '').toLowerCase();
  const activeCategory = req.query.category || 'all';

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
      prices: JSON.parse(row.prices_json)
    }));

    const filteredProducts = dbProducts.filter((p) => {
      const matchesName = p.name.toLowerCase().includes(query);
      const matchesCategory =
        activeCategory === 'all' || p.categoryId === activeCategory;
      return matchesName && matchesCategory;
    });

    const productsWithBest = filteredProducts.map((p) => {
      const entries = Object.entries(p.prices);
      if (entries.length === 0) {
        return { ...p, bestStoreId: null };
      }
      const best = entries.reduce(
        (min, [storeId, price]) =>
          price < min.price ? { storeId, price } : min,
        { storeId: entries[0][0], price: entries[0][1] }
      );
      return { ...p, bestStoreId: best.storeId };
    });

    res.render('index', {
      stores,
      products: productsWithBest,
      query,
      categories,
      activeCategory
    });
  });
});

// Auth routes
app.get('/register', (req, res) => {
  res.render('register', { error: null, form: { email: '' } });
});

app.post('/register', (req, res) => {
  const { email, password, confirmPassword } = req.body;

  if (!email || !password || !confirmPassword) {
    return res.render('register', {
      error: 'Täida kõik väljad.',
      form: { email }
    });
  }

  if (password !== confirmPassword) {
    return res.render('register', {
      error: 'Paroolid ei ühti.',
      form: { email }
    });
  }

  db.get('SELECT id FROM users WHERE email = ?', [email], (err, existing) => {
    if (err) {
      console.error(err);
      return res.render('register', {
        error: 'Serveri viga. Proovi hiljem uuesti.',
        form: { email }
      });
    }

    if (existing) {
      return res.render('register', {
        error: 'Sellise e-posti aadressiga kasutaja on juba olemas.',
        form: { email }
      });
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    db.get('SELECT COUNT(*) AS count FROM users', (countErr, row) => {
      if (countErr) {
        console.error(countErr);
        return res.render('register', {
          error: 'Serveri viga. Proovi hiljem uuesti.',
          form: { email }
        });
      }

      const isFirstUser = row && row.count === 0;
      const role = isFirstUser ? 'admin' : 'user';

      db.run(
        'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
        [email, passwordHash, role],
        function (insertErr) {
          if (insertErr) {
            console.error(insertErr);
            return res.render('register', {
              error: 'Serveri viga. Proovi hiljem uuesti.',
              form: { email }
            });
          }

          return res.redirect('/login');
        }
      );
    });
  });
});

app.get('/login', (req, res) => {
  res.render('login', { error: null, form: { email: '' } });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', {
      error: 'Sisesta e-post ja parool.',
      form: { email }
    });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err) {
      console.error(err);
      return res.render('login', {
        error: 'Serveri viga. Proovi hiljem uuesti.',
        form: { email }
      });
    }

    if (!user) {
      return res.render('login', {
        error: 'Vale e-post või parool.',
        form: { email }
      });
    }

    const isValid = bcrypt.compareSync(password, user.password_hash);
    if (!isValid) {
      return res.render('login', {
        error: 'Vale e-post või parool.',
        form: { email }
      });
    }

    req.session.user = { id: user.id, email: user.email, role: user.role || 'user' };
    return res.redirect('/profile');
  });
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

app.post('/admin/products', requireAdmin, (req, res) => {
  const { name, categoryId, slug: rawSlug } = req.body;

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
    'INSERT INTO products (slug, name, category, category_id, prices_json) VALUES (?, ?, ?, ?, ?)',
    [slug, name, category, categoryId, JSON.stringify(prices)],
    (err) => {
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

      return res.redirect('/admin/products');
    }
  );
});

// Product details page
app.get('/product/:slug', (req, res) => {
  const slug = req.params.slug;
  db.get('SELECT * FROM products WHERE slug = ?', [slug], (err, row) => {
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
      prices: JSON.parse(row.prices_json)
    };

    res.render('product', {
      stores,
      product
    });
  });
});

// Simple 404 fallback
app.use((req, res) => {
  res.status(404).render('not-found');
});

app.listen(PORT, () => {
  console.log(`ToiduHind.ee Node server running on http://localhost:${PORT}`);
});

