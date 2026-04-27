# ToiduHind.ee

Node.js + Express veebirakendus toiduainete hindade võrdlemiseks, ostukorvi haldamiseks, tellimuste esitamiseks ja kulleri töövoo testimiseks.

## Funktsionaalsus

- Toodete kataloog kategooriate, otsingu ja sorteerimisega
- Kasutaja konto: registreerimine, sisselogimine, profiil
- Ostukorv (session + DB sync)
- Checkout ja testpanga maksevoolud
- Swedbank Sandbox Payment Initiation (V3) integratsioon
- Tellimuste ajalugu:
  - aktiivsed tellimused
  - eelmised tellimused (dostarvitud/tühistatud, max 5)
  - tellimuse kordamine (lisab tooted uuesti korvi)
  - tellimuse tühistamine kasutaja poolt
- Kulleri vaade:
  - kõigi aktiivsete tellimuste nimekiri
  - staatuste muutmine (`Töös`, `Teel kliendile`, `Kätte toimetatud`)
- Admin vaated toodete, kategooriate ja kasutajate halduseks
- API dokumentatsioon Swaggeri kaudu

## Tehnoloogiad

- Node.js (CommonJS)
- Express
- EJS
- SQLite (`sqlite3`)
- `express-session`
- `swagger-jsdoc` + `swagger-ui-express`

## Nõuded

- Node.js 18+ (soovituslikult 20+)
- npm

## Paigaldus

```bash
npm install
```

## Käivitamine

Arendusrežiim:

```bash
npm run dev
```

Tavakäivitus:

```bash
npm start
```

Pärast käivitust:

- App: [http://localhost:3000](http://localhost:3000)
- Swagger: [http://localhost:3000/api-docs](http://localhost:3000/api-docs)

## Keskkonnamuutujad (`.env`)

Miinimum:

```env
SESSION_SECRET=your_strong_secret
```

Swedbank Sandbox jaoks:

```env
SWEDBANK_REDIRECT_URL=https://your-domain.ngrok-free.dev/checkout/swedbank/return
SWEDBANK_NOTIFICATION_URL=https://your-domain.ngrok-free.dev/checkout/swedbank/notification
```

Valikulised Swedbank seaded:

```env
SWEDBANK_SANDBOX_BASE_URL=https://pi-playground.swedbank.com/sandbox
SWEDBANK_AGREEMENT_COUNTRY=EE
SWEDBANK_MERCHANT_ID=SANDBOX_RSA
SWEDBANK_PROVIDER_BIC=HABAEE2X
SWEDBANK_SANDBOX_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

> NB! Sandbox nõuab callback URL-ide jaoks HTTPS-i. Lokaliseks testiks kasuta ngrok/cloudflared tunnelit.

## Swedbank Sandbox kiire test

1. Käivita app (`npm start`)
2. Käivita tunnel:
   ```bash
   ngrok http 3000
   ```
3. Pane tunneli HTTPS URL `.env` faili (`SWEDBANK_REDIRECT_URL`, `SWEDBANK_NOTIFICATION_URL`)
4. Taaskäivita server
5. Tee tellimus ja vali checkoutis Swedbank
6. Sandbox lehel vali staatus (`EXECUTED` või `SETTLED`)
7. Kontrolli, et kasutaja suunatakse tagasi ja tellimus salvestub

## Rollid

- `user`:
  - ostlemine
  - checkout
  - tellimuste vaatamine / kordamine / tühistamine
- `courier`:
  - kulleri tellimuste vaade
  - kohaletoimetamise staatuste muutmine
- `admin`:
  - toodete, kategooriate ja kasutajate haldus

Rolli muutmise helper endpoint:

- `POST /api/users/role` (email või username + role)

## Andmebaas

SQLite fail luuakse projekti juurkausta: `toiduhind.db`.

Rakendus loob vajalikud tabelid automaatselt käivitumisel ning lisab testandmed (tooted/kategooriad), kui tabelid on tühjad.

## Projektistruktuur (lühidalt)

- `server.js` – kogu backend loogika ja route'id
- `views/` – EJS templated
- `public/css/styles.css` – põhiline stiil
- `toiduhind.db` – SQLite andmebaas (runtime)

## Märkused

- Swedbank Sandbox on testkeskkond; tootmises kasuta panga ametlikku lepingut, võtmeid ja sertifikaatide kontrolli.
- Kui ngrok URL muutub, uuenda `.env` callback muutujad ja taaskäivita server.
## ToiduHind.ee (Node.js versioon)

Lihtne veebirakendus toidukaupade hindade võrdlemiseks Eesti poodides, ehitatud Node.js ja Expressi peale.

### Tehnoloogiad

- Node.js (Express)
- EJS templated (server-side renderdus)
- Statiline CSS (dark theme)

### Kuidas käivitada

```bash
npm install
npm run dev
```

Seejärel ava brauseris `http://localhost:3000`.

### Struktuur

- `server.js` – põhirakendus, marsruudid ja makett-andmed
- `views/` – EJS mallid (avaleht, tooteleht, 404)
- `public/css/styles.css` – stiilid

Hetkel kasutatakse makett-andmeid (statiline massiiv toodetest ja hindadest poodides). Hiljem saab selle asendada päris andmebaasi ja/või API integratsiooniga (Rimi, Prisma, Maxima, Coop jms), järgides algse projekti [toiduHind](https://github.com/fstez/toiduHind) loogikat.

