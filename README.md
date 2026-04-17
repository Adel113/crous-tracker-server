# 🏠 CROUS Tracker — Serveur Node.js

Surveillance 24/7 des logements CROUS avec alertes email. Tourne en continu sur Railway (gratuit).

---

## Déploiement sur Railway (5 minutes)

### Étape 1 — Prépare ton compte Gmail

Railway n'a pas accès à ton compte Gmail directement. Il faut créer un **mot de passe d'application** :

1. Va sur [myaccount.google.com/security](https://myaccount.google.com/security)
2. Active la **validation en 2 étapes** si ce n'est pas fait
3. Cherche **"Mots de passe des applications"**
4. Crée une appli → nom : "CROUS Tracker" → copie le mot de passe généré (16 caractères)

> Ce mot de passe sera ta valeur `SMTP_PASS`.

---

### Étape 2 — Mets le code sur GitHub

```bash
# Dans le dossier du projet
git init
git add .
git commit -m "CROUS Tracker initial"

# Crée un dépôt sur github.com (bouton "New repository")
# Puis :
git remote add origin https://github.com/TON_USERNAME/crous-tracker-server.git
git push -u origin main
```

> ⚠️ Le fichier `.env` est dans `.gitignore` — il ne sera jamais uploadé. Tes mots de passe restent privés.

---

### Étape 3 — Déploie sur Railway

1. Va sur [railway.app](https://railway.app) et connecte-toi avec GitHub
2. Clique **"New Project"** → **"Deploy from GitHub repo"**
3. Sélectionne ton dépôt `crous-tracker-server`
4. Railway détecte automatiquement Node.js et lance `npm start`

---

### Étape 4 — Configure les variables d'environnement

Dans Railway, va dans ton projet → onglet **"Variables"** → ajoute ces variables une par une :

| Variable | Valeur |
|---|---|
| `CITIES` | `Paris,Lyon,Bordeaux` |
| `MAX_PRICE` | `600` |
| `INTERVAL_MINUTES` | `5` |
| `EMAIL_TO` | `ton.email@exemple.com` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `ton.email@gmail.com` |
| `SMTP_PASS` | `xxxx xxxx xxxx xxxx` ← mot de passe d'app |

Clique **"Deploy"** → Railway redémarre le service avec la config.

---

### Étape 5 — Vérifie que ça tourne

Dans Railway → onglet **"Logs"**, tu dois voir :

```
════════════════════════════════════════
  CROUS TRACKER — Serveur démarré
════════════════════════════════════════
Villes     : Paris, Lyon, Bordeaux
Loyer max  : 600€/mois
Intervalle : 5 minutes
Email vers : ton.email@exemple.com
════════════════════════════════════════

[...] ── Vérification #1 (Paris, Lyon, Bordeaux) ──
[...] Paris : 12 logement(s) trouvé(s)
[...] Lyon : 8 logement(s) trouvé(s)
[...] Bordeaux : 5 logement(s) trouvé(s)
[...] Aucun nouveau logement. (25 connu(s) au total)
[...] ── Prochaine vérif dans 5 min ──
```

---

## Tester en local

```bash
# Installe les dépendances
npm install

# Copie et remplis le fichier de config
cp .env.example .env
# Édite .env avec tes valeurs

# Charge le .env et lance
node -e "require('fs').readFileSync('.env','utf8').split('\n').forEach(l=>{const[k,...v]=l.split('=');if(k&&!k.startsWith('#'))process.env[k.trim()]=v.join('=').trim()})" && node index.js

# Ou avec le package dotenv (optionnel) :
npm install dotenv
# Puis ajoute require('dotenv').config(); en haut de index.js
```

---

## Structure des fichiers

```
crous-tracker-server/
├── index.js        ← Script principal (scraping + email)
├── package.json    ← Dépendances Node.js
├── .env.example    ← Template de configuration
├── .gitignore      ← Exclut .env et node_modules
└── README.md       ← Ce fichier
```

---

## Plan gratuit Railway

Railway offre **5$ de crédits par mois** aux nouveaux comptes. Un service Node.js léger comme celui-ci consomme environ **0,5$/mois** → tu as largement de quoi faire.

Pour ne jamais dépasser le quota gratuit : garde `INTERVAL_MINUTES=5` ou plus.

---

## Villes supportées

Paris, Lyon, Marseille, Bordeaux, Toulouse, Lille, Rennes, Nantes, Montpellier, Strasbourg, Grenoble, Nice, Nancy, Caen, Clermont-Ferrand, Dijon, Rouen, Tours, Poitiers, Amiens, Reims, Besançon, Pau, Perpignan, Nîmes, Angers, Le Mans, Orléans, Metz, Brest, Versailles, Créteil, Aix-en-Provence, Limoges.
