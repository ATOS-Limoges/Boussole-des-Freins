// Actualise evenements.json à partir de l'API « Mes événements emploi » de France Travail.
// Lancé chaque jour par GitHub Actions (voir update-evenements.yml). Aucune clé n'est écrite dans ce fichier :
// les identifiants viennent des « secrets » GitHub, le reste des « variables » GitHub.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const env = n => (process.env[n] || '').trim();
const CLIENT_ID = env('FT_CLIENT_ID');
const CLIENT_SECRET = env('FT_CLIENT_SECRET');
const SCOPE = env('FT_SCOPE');            // à copier depuis la documentation de l'API sur francetravail.io
const EVENTS_URL = env('FT_EVENTS_URL');  // adresse de la requête qui liste les événements (idem)
const QUERY = env('FT_EVENTS_QUERY');     // filtres éventuels, ex. : codeDepartement=87 (selon la documentation)
const TOKEN_URL = env('FT_TOKEN_URL') || 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const OUT = env('OUTPUT_FILE') || 'evenements.json';
const MAX = Number(env('MAX_EVENTS')) || 12;
const DEBUG = env('DEBUG') === '1';
// Filtre de sécurité côté script : ne garde que les événements dont le lieu évoque la Haute-Vienne.
// Mettre FT_LOCAL_FILTER=off si la requête filtre déjà par département.
const LOCAL_FILTER = env('FT_LOCAL_FILTER') !== 'off';
const HV = /\b87\d{3}\b|haute[- ]vienne|limoges|bellac|saint[- ]junien|st[- ]junien|saint[- ]yrieix|st[- ]yrieix|rochechouart|aixe|isle|panazol|couzeix/i;

const fail = msg => { console.error('::error::' + msg); process.exit(1); };

const missing = Object.entries({ FT_CLIENT_ID: CLIENT_ID, FT_CLIENT_SECRET: CLIENT_SECRET, FT_SCOPE: SCOPE, FT_EVENTS_URL: EVENTS_URL })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) fail('Paramètres manquants dans GitHub (Settings > Secrets and variables > Actions) : ' + missing.join(', '));

async function getToken() {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, scope: SCOPE }),
  });
  const body = await res.text();
  if (!res.ok) fail(`Authentification refusée (HTTP ${res.status}). Vérifiez FT_SCOPE et l'abonnement de l'application à l'API. Réponse : ${body.slice(0, 300)}`);
  const token = JSON.parse(body).access_token;
  if (!token) fail("Réponse d'authentification sans access_token.");
  return token;
}

const pick = (o, ...keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((a, p) => (a == null ? undefined : a[p]), o);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
};
const text = v => (v && typeof v === 'object' ? String(v.libelle || v.nom || v.ville || v.label || '') : String(v ?? '')).trim();

function parisParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, h: +p.hour, m: +p.minute };
}
const hm = ({ h, m }) => (m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`);
// Une date sans fuseau (ex. 2026-10-26T09:15:00) est lue comme une heure de Paris, pas comme une heure du serveur (UTC).
function toDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(String(v).trim());
  if (m) {
    const [y, mo, d, h = 0, mi = 0] = m.slice(1).map(x => (x === undefined ? undefined : Number(x)));
    for (const off of [2, 1]) {
      const t = new Date(Date.UTC(y, mo - 1, d, h - off, mi));
      const p = parisParts(t);
      if (p.date === `${m[1]}-${m[2]}-${m[3]}` && p.h === h && p.m === mi) return t;
    }
  }
  const t = new Date(v);
  return isNaN(t) ? null : t;
}

function normalize(e) {
  const start = toDate(pick(e, 'dateDebut', 'dateDebutEvenement', 'startDate', 'date'));
  if (!start) return null;
  const end = toDate(pick(e, 'dateFin', 'dateFinEvenement', 'endDate'));
  const a = parisParts(start), b = end ? parisParts(end) : null;
  let heure = '';
  if (!(a.h === 0 && a.m === 0)) heure = b && b.date === a.date && (b.h !== a.h || b.m !== a.m) ? `${hm(a)} – ${hm(b)}` : hm(a);
  const id = pick(e, 'id', 'idEvenement', 'identifiant');
  let url = text(pick(e, 'urlSalonEnLigne', 'url', 'lien', 'urlEvenement'));
  if (!/^https:\/\//.test(url)) url = id ? `https://mesevenementsemploi.francetravail.fr/mes-evenements-emploi/evenement/${id}` : '';
  const lieu = text(pick(e, 'lieu', 'localisation', 'ville', 'adresse.ville', 'adresse'));
  const around = [lieu, text(pick(e, 'codePostal', 'adresse.codePostal')), text(pick(e, 'departement', 'codeDepartement'))].join(' ');
  return { _around: around, date: a.date, titre: text(pick(e, 'titre', 'title', 'intitule', 'nom')), heure, lieu, url };
}

const token = await getToken();
const url = EVENTS_URL + (QUERY ? (EVENTS_URL.includes('?') ? '&' : '?') + QUERY : '');
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
const raw = await res.text();
if (!res.ok) fail(`Lecture des événements impossible (HTTP ${res.status}). Réponse : ${raw.slice(0, 300)}`);
const data = JSON.parse(raw);
const list = Array.isArray(data) ? data : (data.resultats || data.evenements || data.events || data.content || data.items || data.data || []);
if (DEBUG) {
  console.log('Événements reçus :', list.length);
  if (list[0]) console.log('Champs du premier événement :', Object.keys(list[0]).join(', '));
  if (list[0]) console.log('Premier événement (normalisé) :', JSON.stringify(normalize(list[0])));
}

const today = parisParts(new Date()).date;
const seen = new Set();
const items = list.map(normalize).filter(Boolean)
  .filter(e => e.titre && e.date >= today)
  .filter(e => !LOCAL_FILTER || HV.test(e._around))
  .filter(e => { const k = e.url || e.titre + e.date; if (seen.has(k)) return false; seen.add(k); return true; })
  .sort((x, y) => x.date.localeCompare(y.date) || x.heure.localeCompare(y.heure))
  .slice(0, MAX)
  .map(({ _around, ...rest }) => rest);

if (!items.length) {
  console.log(`::warning::Aucun événement à venir retenu (${list.length} reçus). ${OUT} n'a pas été modifié. Relancez avec la variable DEBUG=1 pour inspecter les champs.`);
  process.exit(0);
}
const previous = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
writeFileSync(OUT, JSON.stringify({ maj: today, items }, null, 2) + '\n');
console.log(`${items.length} événements écrits dans ${OUT}.`, previous ? '' : '(nouveau fichier)');
