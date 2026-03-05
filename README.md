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

