// Modul LOCAL FĂRĂ LOGIN — cerut 2026-08-25: „vreau să văd toate sectoarele pe
// :3000 și să intru în ele fără login, cât lucrăm pe local".
//
// De ce nu ajunge `NODE_ENV !== "production"`, verificarea folosită până acum de
// `proxy.ts` și de poarta /master: serverul de pe :3000 e un build de PRODUCȚIE
// (agent launchd, `next start`), deci pentru el `NODE_ENV === "production"` e
// adevărat, iar autologin-ul de dezvoltare era stins exact pe adresa la care
// lucrează omul. Nu e o scăpare — e diferența dintre „mediu de dezvoltare" și
// „mașina mea".
//
// Deci deschiderea se face pe DOUĂ condiții care trebuie adevărate SIMULTAN:
//
//   1. `LOCAL_NO_LOGIN=1` — un consimțământ explicit, pornit pe serviciul local.
//      Absent = oprit; nicio valoare implicită nu deschide nimic.
//   2. Cererea vine de pe localhost — `isLocalRequestHost` de mai jos.
//
// ATENȚIE: antetul `Host` îl alege clientul. Oricine ajunge direct la socket
// poate trimite `Host: localhost` — dovedit 2026-10-02: de pe Wi-Fi, cu serverul
// legat pe toate interfețele, `curl -H "Host: localhost:3000" http://<ip-LAN>:3000`
// intra ca admin. Garanția reală e ca serverul să asculte DOAR pe loopback
// (`-H 127.0.0.1` în agentul launchd și în scripts/dev-local.sh); condiția 2 e
// doar o a doua plasă pentru un deploy în spatele unui proxy care rutează după
// domeniu. Nu porni niciodată un server cu `LOCAL_NO_LOGIN=1` pe 0.0.0.0.
//
// Ambele funcții sunt pure în raport cu cererea: predicatul primește host-ul,
// nu-l citește singur, fiindcă apelanții au surse diferite pentru el —
// `proxy.ts` are `NextRequest`, iar componentele de server au `headers()`.

/** Consimțământul explicit. Doar „1" — nici „true", nici „yes", nici gol. */
export function localNoLoginFlag(): boolean {
  return process.env.LOCAL_NO_LOGIN === "1";
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Adevărat doar dacă antetul `Host` numește chiar mașina asta.
 *
 * Antetul vine cu port („localhost:3000") și, pe IPv6, cu paranteze
 * („[::1]:3000"), deci portul se taie cu grijă: un `split(":")[0]` naiv ar
 * rupe adresa IPv6 la primul caracter și ar întoarce „[" — adică ar refuza o
 * cerere locală legitimă. Numele se compară exact, nu prin `startsWith`:
 * „localhost.atacator.example" începe cu „localhost" fără să fie localhost.
 */
export function isLocalRequestHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const trimmed = host.trim().toLowerCase();
  const hostname = trimmed.startsWith("[")
    ? trimmed.slice(0, trimmed.indexOf("]") + 1)
    : trimmed.split(":")[0];
  return LOCAL_HOSTNAMES.has(hostname);
}

/** Poarta întreagă: consimțământ explicit ȘI cerere venită de pe mașina asta. */
export function localNoLoginActive(host: string | null | undefined): boolean {
  return localNoLoginFlag() && isLocalRequestHost(host);
}
