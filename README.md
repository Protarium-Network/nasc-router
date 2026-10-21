# nasc-router

NASC front for 3DS consoles, used with a [Pretendo account server](https://github.com/PretendoNetwork/account).

- `POST /ac`: if the request's `titleid` is listed in the Mongo `servers` collection (`title_ids`), it goes to the
  local Pretendo account server. Anything else is proxied to the real `nasc.pretendo.cc`. The list is reloaded every 60 s.
- `POST /protarium-connect/register` (reached via `account.<domain>`, see `deploy/account_location.txt`): used by the
  Protarium Connect 3DS homebrew. Form fields `pid` (decimal) and `password` (the console's real Pretendo NEX secret
  from `FRD_GetMyPassword`). Stored in the local `nexaccounts` so self-hosted games can authenticate the console
  (NEX servers read it via the account server's gRPC `GetNEXPassword`). First write wins: a different password for an
  existing pid gets 409. 20 requests/hour/IP. Known limit: the request carries no console certificate, so nothing
  proves the caller owns the pid.

## Install
1. Run the Pretendo account server (`npm ci && npx tsc && npx tsc-alias`, copy non-ts files from `src/` to `dist/`) with
   `PN_ACT_CONFIG_HTTP_PORT=7071` and `PN_ACT_CONFIG_DOMAINS_NASC=<your nasc domain>` in `.env`.
2. Drop `nasc-router.js` next to it (it requires `mongodb` from the account server's `node_modules`).
3. `deploy/*.service` are systemd units (paths assume `/opt/pn-account`); `deploy/nasc_block.txt` is the nginx
   server block (3DS needs old TLS, hence `ssl_protocols TLSv1 ... ssl_ciphers ALL`).
4. Point the console's NASC URL (patched friends module, see Nimbus) at `https://<your nasc domain>`.

Env: `PN_ACT_CONFIG_MONGO_CONNECTION_STRING` and `NASC_LOCAL_HOST` (required), `NASC_ROUTER_PORT` (7070), `NASC_LOCAL_URL` (`http://127.0.0.1:7071`).

The account server is [PretendoNetwork/account](https://github.com/PretendoNetwork/account); `nasc-router` only needs its Mongo `servers` collection (`title_ids`) and `nexaccounts`.

## License
GNU AGPL v3, see `LICENSE`.
