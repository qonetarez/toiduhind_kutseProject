# ToiduHind.ee

Node.js + Express веб-приложение для сравнения цен на продукты, оформления заказов, работы курьера и тестирования оплаты через банк.

## Возможности

- Каталог товаров с поиском, категориями и сортировкой
- Регистрация, вход и профиль пользователя
- Корзина (session + синхронизация с БД)
- Checkout и банковские тестовые формы
- Интеграция Swedbank Sandbox Payment Initiation (V3)
- История заказов:
  - активные заказы
  - прошлые заказы (доставленные/отмененные, максимум 5)
  - повтор заказа (добавляет товары обратно в корзину)
  - отмена заказа пользователем
- Кабинет курьера:
  - список активных заказов
  - смена статусов доставки
- Админ-панели для товаров, категорий и пользователей
- Swagger-документация API

## Стек

- Node.js (CommonJS)
- Express
- EJS
- SQLite (`sqlite3`)
- `express-session`
- `swagger-jsdoc` + `swagger-ui-express`

## Требования

- Node.js 18+ (лучше 20+)
- npm

## Установка

```bash
npm install
```

## Запуск

Разработка:

```bash
npm run dev
```

Обычный запуск:

```bash
npm start
```

После запуска:

- Приложение: [http://localhost:3000](http://localhost:3000)
- Swagger: [http://localhost:3000/api-docs](http://localhost:3000/api-docs)

## Переменные окружения (`.env`)

Минимум:

```env
SESSION_SECRET=your_strong_secret
```

Для Swedbank Sandbox:

```env
SWEDBANK_REDIRECT_URL=https://your-domain.ngrok-free.dev/checkout/swedbank/return
SWEDBANK_NOTIFICATION_URL=https://your-domain.ngrok-free.dev/checkout/swedbank/notification
```

Дополнительно:

```env
SWEDBANK_SANDBOX_BASE_URL=https://pi-playground.swedbank.com/sandbox
SWEDBANK_AGREEMENT_COUNTRY=EE
SWEDBANK_MERCHANT_ID=SANDBOX_RSA
SWEDBANK_PROVIDER_BIC=HABAEE2X
SWEDBANK_SANDBOX_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

> В Sandbox callback URL должны быть HTTPS. Для локальной разработки используйте ngrok/cloudflared.

## Быстрый тест Swedbank Sandbox

1. Запустите приложение (`npm start`)
2. Поднимите туннель:
   ```bash
   ngrok http 3000
   ```
3. Обновите `.env` (`SWEDBANK_REDIRECT_URL`, `SWEDBANK_NOTIFICATION_URL`)
4. Перезапустите сервер
5. Сделайте заказ и выберите Swedbank
6. На странице sandbox выберите статус (`EXECUTED` или `SETTLED`)
7. Убедитесь, что есть возврат на сайт и заказ сохранен

## Роли

- `user`: покупки, заказы, отмена/повтор
- `courier`: список заказов и статусы доставки
- `admin`: управление товарами, категориями и пользователями

## База данных

SQLite-файл создается автоматически: `toiduhind.db`.

## Краткая структура

- `server.js` – серверная логика и роуты
- `views/` – EJS шаблоны
- `public/css/styles.css` – стили
- `toiduhind.db` – SQLite база
